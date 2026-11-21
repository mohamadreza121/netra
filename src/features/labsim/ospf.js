import { forwardsIpv4, inSubnet, ipv4, linkUp, networkAddress, segment } from './network.js';
import { applyPolicy } from './route-policy.js';

export const areaId=value=>/^\d{1,10}$/.test(value??'')&&Number(value)<=4294967295?Number(value):ipv4(value);
const comparePaths=(a,b)=>(a.kind??0)-(b.kind??0)||a.metric-b.metric;

export function ospfInterfaces(lab, device) {
  const process = device.ospf;
  if (!process||!forwardsIpv4(device)) return [];
  return Object.entries(device.ports).flatMap(([port, setting]) => {
    if (!setting.address || setting.vrf || !linkUp(lab, device, port)) return [];
    const matched=process.networks.filter(rule => ((ipv4(setting.address)^ipv4(rule.address))&~ipv4(rule.wildcard))===0)
      .sort((a,b)=>ipv4(a.wildcard)-ipv4(b.wildcard))[0];
    if (setting.ospf?.process!==process.id&&!matched) return [];
    const area=setting.ospf?.process===process.id?setting.ospf.area??0:matched.area??0;
    const areaConfig=process.areas?.[area];
    return [{port, address:setting.address, prefix:setting.prefix,area,
      stub:areaConfig?.stub??false, authentication:setting.ospf?.authentication??areaConfig?.authentication,
      keys:setting.ospf?.keys,
      passive:process.passive[port] ?? process.passiveDefault ?? false,
      cost:setting.ospf?.cost ?? Math.max(1, Math.floor((process.reference ?? 100) * 1000 / (setting.bandwidth ?? 1000000))),
      hello:setting.ospf?.hello ?? 10, dead:setting.ospf?.dead ?? 40,
      priority:setting.ospf?.priority ?? 1, network:setting.ospf?.network ?? 'broadcast'}];
  });
}

export function routerId(device) {
  const addresses = ([, port]) => port.address;
  const highest = entries => entries.map(addresses).filter(Boolean).sort((a,b)=>ipv4(b)-ipv4(a))[0];
  const ports = Object.entries(device.ports);
  return device.ospf?.routerId ?? highest(ports.filter(([name])=>name.startsWith('Lo'))) ?? highest(ports);
}

export function ospfNeighbors(lab, device, interfaces) {
  const links = [];
  for (const local of interfaces.get(device.id) ?? []) {
    if (local.passive || local.port.startsWith('Lo')) continue;
    for (const reachable of segment(lab,device,local.port,false,'control')) {
      const remote=interfaces.get(reachable.device.id)?.find(entry=>entry.port===reachable.port);
      if(!remote||remote.passive||local.area!==remote.area||local.stub!==remote.stub||local.network!==remote.network||
        local.hello!==remote.hello||local.dead!==remote.dead||local.authentication!==remote.authentication)continue;
      if(local.authentication==='message-digest'&&!Object.entries(local.keys??{}).some(([key,value])=>remote.keys?.[key]===value))continue;
      if (local.network==='broadcast' && local.priority===0 && remote.priority===0) continue;
      if (local.prefix!==remote.prefix || networkAddress(local.address,local.prefix)!==networkAddress(remote.address,remote.prefix)) continue;
      if (routerId(device)===routerId(reachable.device)) continue;
      links.push({device:reachable.device, local, remote});
    }
  }
  return links;
}

export const ospfSnapshot = lab => new Map(lab.devices.filter(device=>device.ospf).map(device=>[device.id,ospfInterfaces(lab,device)]));

const areasAt=(ports,device)=>new Set((ports.get(device.id)??[]).map(p=>p.area));
function throughArea(areas,next,available) {
  if(areas.at(-1)===next)return areas;
  if(!areas.length)return [next];
  if(!available.has(0)||areas.includes(next)||areas.length>=3||areas.length===2&&areas[1]!==0)return null;
  return areas.at(-1)!==0&&next!==0?[...areas,0,next]:[...areas,next];
}

function pathSnapshot(lab,source,ports) {
  const best=new Map([[source.id+':',{device:source,metric:0,areas:[],history:[source]}]]);
  const links=new Map([...ports.keys()].map(id=>{
    const device=lab.devices.find(d=>d.id===id);
    return [id,ospfNeighbors(lab,device,ports)];
  }));
  const visited=new Set();
  while(true) {
    const entry=[...best.entries()].filter(([key])=>!visited.has(key)).sort((a,b)=>a[1].metric-b[1].metric)[0];
    if(!entry)break;
    const [key,current]=entry;
    const device=current.device;
    visited.add(key);
    for(const {device:neighbor,local,remote} of links.get(device.id)){
      const areas=throughArea(current.areas,local.area,areasAt(ports,device));
      if(!areas||current.history.includes(neighbor))continue;
      const id=neighbor.id+':'+areas.join(',');
      const metric=current.metric+local.cost;
      if(metric>=(best.get(id)?.metric??Infinity))continue;
      best.set(id,{device:neighbor,metric,port:current.port??local.port,next:current.next??remote.address,
        areas,history:[...current.history,neighbor]});
    }
  }
  return [...best.values()].filter(row=>row.device!==source);
}

const displayRoute=(current,destination,prefix,metric,kind,ospfType,tag)=>({
  destination,prefix,port:current.port,next:current.next,distance:110,metric,kind,ospfType,protocol:'ospf',tag
});
function advertisedExternal(lab,d,staticRoutes,borrow) {
  const cfg=d.ospf;
  const rows=[];
  if(cfg.defaultRoute&&(cfg.defaultRoute==='always'||staticRoutes(lab,d).some(r=>r.prefix===0))) {
    rows.push({destination:'0.0.0.0',prefix:0,metric:1,type:2});
  }
  if(!Object.keys(cfg.redistribute??{}).length)return rows;
  for(const route of borrow(lab,d)){
    const policy=cfg.redistribute[route.protocol];
    if(!policy||route.prefix===0||policy.process!==undefined&&policy.process!==route.process)continue;
    if(!policy.subnets&&route.prefix!==(ipv4(route.destination)>>>24<128?8:ipv4(route.destination)>>>24<192?16:24))continue;
    const filtered=applyPolicy(d,policy.map,{...route,metric:policy.metric??(route.protocol==='bgp'?1:20),tag:policy.tag??route.tag});
    if(filtered)rows.push({...filtered,type:policy.type??2});
  }
  return rows;
}

export function ospfRoutes(lab, source, staticRoutes, external=()=>[]) {
  if (!source.ospf||!forwardsIpv4(source)) return [];
  const ports=ospfSnapshot(lab);
  const best=new Map();
  const install=(row)=>{
    const key=row.destination+'/'+row.prefix;
    if(!best.has(key)||comparePaths(row,best.get(key))<0)best.set(key,{...row,process:source.ospf.id});
  };
  for(const current of pathSnapshot(lab,source,ports)){
    const device=current.device;
    const sourceArea=current.areas[0];
    const sourceStub=source.ospf.areas?.[sourceArea]?.stub;
    const areas=areasAt(ports,device);
    const stubBorder=sourceStub&&areas.has(0)&&areas.has(sourceArea);
    const noSummary=current.history.some(router=>router.ospf.areas?.[sourceArea]?.noSummary&&areasAt(ports,router).has(0));
    if(stubBorder)install(displayRoute(current,'0.0.0.0',0,current.metric+1,1,'IA'));
    for(const intf of ports.get(device.id)){
      const advertise=throughArea(current.areas,intf.area,areas);
      if(!advertise)continue;
      const inter=advertise.length>1;
      if(inter&&noSummary)continue;
      const address=networkAddress(intf.address,intf.prefix);
      const summary=inter&&[...current.history].reverse().flatMap(border=>{
        const areaSet=areasAt(ports,border);
        if(!areaSet.has(0)||!areaSet.has(intf.area))return [];
        return border.ospf.areas?.[intf.area]?.ranges??[];
      }).filter(r=>intf.prefix>=r.prefix&&inSubnet(address,r.address,r.prefix)).sort((a,b)=>b.prefix-a.prefix)[0];
      if(summary?.noAdvertise)continue;
      install(displayRoute(current,summary?.address??address,summary?.prefix??intf.prefix,summary?.cost??(current.metric+intf.cost),inter?1:0,inter?'IA':undefined));
    }
    if(!sourceStub)for(const r of advertisedExternal(lab,device,staticRoutes,external)){
      if(current.areas.some(area=>device.ospf.areas?.[area]?.stub)&&!areas.has(0))continue;
      install(displayRoute(current,r.destination,r.prefix,r.type===1?current.metric+r.metric:r.metric,r.type===1?2:3,r.type===1?'E1':'E2',r.tag));
    }
  }
  return [...best.values()];
}
