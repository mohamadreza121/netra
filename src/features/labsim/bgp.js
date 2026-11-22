import { forwardsIpv4, dotted, inSubnet, ipv4, linkUp, mask, networkAddress, prefixLength, segment } from './network.js';
import { formatV6, interfacesV6, ipv6Underlay, matchesV6, networkV6, parsePrefixV6, parseV6 } from './ipv6.js';
import { interfaceName } from './ios.js';
import { applyPolicy, pathPermits, prefixPermits, routeKey, routingExpression } from './route-policy.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const neighbors=[
  'neighbor <peer> activate','no neighbor <peer> activate',
  'neighbor <peer> next-hop-self','no neighbor <peer> next-hop-self',
  'neighbor <peer> weight <weight>','no neighbor <peer> weight',
  'neighbor <peer> route-map <name> in','neighbor <peer> route-map <name> out',
  'no neighbor <peer> route-map <name> in','no neighbor <peer> route-map <name> out',
  'neighbor <peer> prefix-list <name> in','neighbor <peer> prefix-list <name> out',
  'no neighbor <peer> prefix-list <name> in','no neighbor <peer> prefix-list <name> out',
  'neighbor <peer> route-reflector-client','no neighbor <peer> route-reflector-client',
  'neighbor <peer> send-community [standard]','neighbor <peer> send-community both','neighbor <peer> send-community extended','no neighbor <peer> send-community',
  'neighbor <peer> remove-private-as [all]','no neighbor <peer> remove-private-as',
  'neighbor <peer> default-originate','no neighbor <peer> default-originate',
  'neighbor <peer> filter-list <name> in','neighbor <peer> filter-list <name> out',
  'no neighbor <peer> filter-list <name> in','no neighbor <peer> filter-list <name> out'
];
const af=[
  'network <network> [mask <mask>]','no network <network> [mask <mask>]',...neighbors,
  'redistribute connected [route-map <name>]','redistribute static [route-map <name>]',
  'redistribute ospf <process> [route-map <name>]','redistribute eigrp <asn> [route-map <name>]',
  'no redistribute connected','no redistribute static','no redistribute ospf <process>','no redistribute eigrp <asn>'
];
export const bgpIOS={
  operational:['show ip bgp','show ip bgp <prefix>','show ip bgp summary','show ip bgp neighbors [<address>]',
    'show ip bgp neighbors <address> advertised-routes','show ip bgp neighbors <address> routes',
    'show bgp ipv4 unicast','show bgp ipv4 unicast summary','show bgp ipv4 unicast neighbors [<address>]','show bgp ipv4 unicast <prefix>','show bgp ipv4 unicast regexp <expression...>',
    'show bgp ipv6 unicast','show bgp ipv6 unicast <prefix>','show bgp ipv6 unicast summary','show bgp ipv6 unicast neighbors [<address>]',
    'show bgp ipv4 unicast vrf <name> [summary]','show bgp ipv6 unicast vrf <name> [summary]',
    'show ip bgp peer-group [<name>]','show ip route bgp','show ipv6 route bgp'],
  exec:['clear ip bgp <address> soft in','clear ip bgp <address> soft out'],
  global:['router bgp <asn>','no router bgp <asn>'],
  bgp:['bgp router-id <ip>','bgp default local-preference <value>','no bgp default ipv4-unicast','bgp default ipv4-unicast',
    'neighbor <peer> remote-as <asn>','no neighbor <peer>','neighbor <peer> update-source <interface...>','no neighbor <peer> update-source',
    'neighbor <peer> password <key>','no neighbor <peer> password','neighbor <peer> ebgp-multihop [<ttl>]','no neighbor <peer> ebgp-multihop',
    'neighbor <peer> shutdown','no neighbor <peer> shutdown','neighbor <peer> description <text...>','neighbor <peer> timers <keepalive> <hold>',
    'neighbor <group> peer-group','neighbor <peer> peer-group <group>','bgp log-neighbor-changes','no bgp log-neighbor-changes',
    'bgp cluster-id <address>','address-family ipv4 [unicast] [vrf <name>]','address-family ipv6 [unicast] [vrf <name>]','address-family vpnv4 [unicast]',...af],
  bgpAf:['exit-address-family','neighbor <peer> remote-as <asn>','no neighbor <peer>',...af]
};

const validIp=value=>ipv4(value)!==null;
const classful=address=>ipv4(address)>>>24<128?8:ipv4(address)>>>24<192?16:24;
export const bgpRouterId=d=>d.bgp?.routerId??Object.values(d.ports).map(p=>p.address).filter(Boolean).sort((a,b)=>ipv4(b)-ipv4(a))[0]??'0.0.0.0';


const familyKey=(family,vrf)=>family+(vrf?' '+vrf:'');
function bgpFamily(d,family='ipv4',vrf,create=false) {
  const p=d.bgp;
  if(!p)return null;
  if(family==='ipv4'&&!vrf)return p;
  const key=familyKey(family,vrf);
  if(create){p.families??={};p.families[key]??={networks:[],neighbors:{},redistribute:{}};}
  return own(p.families,key);
}
export const bgpVpnFamily=d=>bgpFamily(d,'vpnv4');
const canonical=value=>validIp(value)?value:parseV6(value)!==null?formatV6(parseV6(value)):null;
const validAddress=(family,value)=>family==='ipv6'?parseV6(value)!==null:validIp(value);
const effectiveNeighbor=(cfg,address)=>{
  const entry=own(cfg?.neighbors,address);
  return entry?{...own(cfg.peerGroups,entry.group),...entry}:undefined;
};
const ipv6Port=(d,port,target)=>{
  const parts=interfacesV6(d,port).filter(a=>!a.linkLocal);
  return parts.find(a=>matchesV6(target,a.address,a.prefix))?.address??parts[0]?.address;
};

export function bgpConfig(d,s,args,c) {
  const no=args[0]==='no', w=no?args.slice(1):args;
  const [verb,sub,value,option,arg]=w;
  if(s.mode==='global'&&verb==='router'&&sub==='bgp'){
    if(!integer(value,1,4294967295))return invalid('Use a BGP AS number from 1 to 4294967295.');
    const asn=Number(value);
    if(no){if(d.bgp?.asn===asn)delete d.bgp;return reply();}
    if(d.bgp&&d.bgp.asn!==asn)return invalid('Remove the existing BGP process before changing its AS number.');
    d.bgp??={asn,neighbors:{},networks:[],redistribute:{}};
    return enter(s,'bgp',asn);
  }
  if(s.mode==='exec'&&c.startsWith('clear ip bgp ')){
    const row=effectiveNeighbor(d.bgp,sub==='ip'?w[3]:null);
    return row?reply('Soft refresh requested. LabSim recomputes received routes from current peer policy.'):invalid('BGP neighbor is not configured.');
  }
  if(!['bgp','bgpAf'].includes(s.mode))return null;
  const process=d.bgp;
  if(!process)return invalid('This BGP process no longer exists.');
  if(c==='exit-address-family'){s.parents?.pop();return enter(s,'bgp',process.asn);}
  if(verb==='address-family'){
    const name=w.includes('vrf')?w.at(-1):undefined;
    if(name&&!own(d.vrfs,name))return invalid('Create the named VRF before configuring BGP.');
    bgpFamily(d,sub,name,true);
    return enter(s,'bgpAf',{family:sub,vrf:name},true);
  }
  const {family='ipv4',vrf}=s.mode==='bgpAf'?s.current:{};
  const cfg=bgpFamily(d,family,vrf,true);
  if(verb==='bgp'){
    if(sub==='router-id'&&validIp(value)){process.routerId=value;return reply();}
    if(sub==='cluster-id'&&validIp(value)){process.clusterId=value;return reply();}
    if(sub==='log-neighbor-changes'){process.logChanges=!no;return reply();}
    if(sub==='default'&&value==='ipv4-unicast'){process.defaultIpv4=!no;return reply();}
    if(sub==='default'&&value==='local-preference'&&integer(option,0,4294967295)){process.localPref=Number(option);return reply();}
    return invalid('Check the BGP process settings.');
  }
  if(verb==='network'){
    const net=family==='ipv6'?parsePrefixV6(sub):{address:sub,prefix:value==='mask'?prefixLength(option):classful(sub)};
    if(!net||net.prefix===null||!validAddress(family,net.address)||
      (family==='ipv6'?networkV6(net.address,net.prefix):networkAddress(net.address,net.prefix))!==net.address)return invalid('Enter a network and a matching mask or prefix length.');
    cfg.networks=cfg.networks.filter(r=>r.destination!==net.address||r.prefix!==net.prefix);
    if(!no)cfg.networks.push({destination:net.address,prefix:net.prefix});
    return reply();
  }
  if(verb==='redistribute'){
    const process=['ospf','eigrp'].includes(sub)?Number(value):undefined;
    const index=w.indexOf('route-map'),map=index<0?undefined:w[index+1];
    if(process!==undefined&&!integer(value,1,65535)||map&&!keyName(map))return invalid('Check the source routing process or route map.');
    if(no)delete cfg.redistribute[sub];else cfg.redistribute[sub]={process,map};
    return reply();
  }
  if(verb==='neighbor'){
    const address=canonical(sub),kind=address&&!validIp(address)?'ipv6':family;
    if(s.mode==='bgpAf'&&address&&!validAddress(family,address))return invalid('This model uses matching transport and address families.');
    const table=bgpFamily(d,kind,vrf,true);
    if(value==='peer-group'){
      table.peerGroups??={};
      if(!address){
        if(!keyName(sub)||option)return invalid('Use a valid peer group name.');
        table.peerGroups[sub]??={};return reply();
      }
      if(!own(table.peerGroups,option))return invalid('Create the peer group first.');
      table.neighbors[address]={...table.neighbors[address],group:option};return reply();
    }
    const peers=address?table.neighbors:table.peerGroups;
    const key=address??sub;
    if(!address&&!own(peers,key))return invalid('Enter the neighbor address or an existing peer group.');
    if(value==='remote-as'){
      if(!integer(option,1,4294967295))return invalid('Enter a valid neighbor AS.');
      if(address&&Object.entries(d.ports).some(([port,p])=>p.vrf===vrf&&
        (kind==='ipv6'?interfacesV6(d,port).some(a=>a.address===address):p.address===address)))return invalid('The neighbor address belongs to this device.');
      peers[key]={...own(peers,key),asn:Number(option)};return reply();
    }
    if(no&&!value){delete peers[key];return reply();}
    if(family==='vpnv4'&&address&&own(process.neighbors,key)&&!own(peers,key)){
      peers[key]={...effectiveNeighbor(process,key),activate:false};
    }
    const neighbor=own(peers,key);
    if(!neighbor)return invalid('Configure neighbor remote-as first.');
    if(['activate','next-hop-self','shutdown','route-reflector-client','default-originate','send-community'].includes(value)){neighbor[value]=no?false:option??true;return reply();}
    if(value==='remove-private-as'){neighbor[value]=no?false:option??true;return reply();}
    if(value==='description'){neighbor.description=w.slice(3).join(' ').slice(0,80);return reply();}
    if(value==='timers'){
      if(!integer(option,0,65535)||!integer(arg,0,65535)||Number(arg)>0&&Number(arg)<Math.max(3,Number(option)))return invalid('Check BGP keepalive and hold times.');
      neighbor.timers=[Number(option),Number(arg)];return reply();
    }
    if(value==='password'){if(no)delete neighbor.password;else neighbor.password=option;return reply();}
    if(value==='update-source'){
      const port=interfaceName(w.slice(3));
      if(no)delete neighbor.source;
      else if(d.ports[port])neighbor.source=port;else return invalid('Select an existing interface.');
      return reply();
    }
    if(value==='ebgp-multihop'||value==='weight'){
      if(no)delete neighbor[value];
      else if(integer(option??'255',value==='weight'?0:1,value==='weight'?65535:255))neighbor[value]=Number(option??255);
      else return invalid('Check the weight or hop limit.');
      return reply();
    }
    if(['prefix-list','route-map','filter-list'].includes(value)&&keyName(option)) {
      const key=value+' '+arg;
      if(no)delete neighbor[key];else neighbor[key]=option;
      return reply();
    }
    return invalid('Check the BGP neighbor settings.');
  }
  return null;
}

function nearest(rib,address,family) {
  return rib.find(r=>(family==='ipv6'?matchesV6:inSubnet)(address,r.destination,r.prefix));
}
const activeFamily=(process,family,setting)=>setting.activate??(family==='ipv4'&&(process.defaultIpv4??true));

function sessionFor(lab,d,remoteIp,setting,devices,ribs,family,vrf) {
  if(setting.shutdown||!activeFamily(d.bgp,family,setting))return {state:'Idle (Admin)'};
  const v6=family==='ipv6';
  const addresses=(node,port)=>v6?interfacesV6(node,port).map(a=>a.address):[node.ports[port]?.address];
  const sourceOn=(node,port,target)=>v6?ipv6Port(node,port,target):node.ports[port]?.address;
  const here=ribs.get(d.id);
  const outgoing=nearest(here,remoteIp,family);
  const sourcePort=setting.source??outgoing?.port;
  const source=sourcePort&&linkUp(lab,d,sourcePort)&&sourceOn(d,sourcePort,remoteIp);
  if(!source||!outgoing)return {state:'Active (no route)'};
  const remote=devices.find(peer=>peer!==d&&Object.entries(peer.ports).some(([name,p])=>p.vrf===vrf&&addresses(peer,name).includes(remoteIp)&&linkUp(lab,peer,name)));
  if(!remote)return {state:'Active (peer unavailable)'};
  const reverse=effectiveNeighbor(bgpFamily(remote,family,vrf),source);
  const external=d.bgp.asn!==remote.bgp.asn;
  if(!reverse||reverse.asn!==d.bgp.asn||setting.asn!==remote.bgp.asn)return {state:'Active (AS or peer mismatch)'};
  if(reverse.shutdown||!activeFamily(remote.bgp,family,reverse))return {state:'Idle (peer disabled)'};
  if(reverse.password!==setting.password)return {state:'Active (authentication mismatch)'};

  // Verify the IGP forwarding path using its own RIB to avoid making a BGP session depend on itself.
  const lookup=(from,toIp,required)=>{
    let here=from,upstream;
    const visited=new Set();
    while(!visited.has(here.id)) {
      visited.add(here.id);
      if(here===required)return visited.size-1;
      const row=nearest(ribs.get(here.id)??[],toIp,family);
      if(!row)return 0;
      upstream=segment(lab,here,row.port,false,'control').find(({device,port})=>device.ports[port]?.vrf===vrf&&addresses(device,port).includes(row.next??toIp));
      if(!upstream)return 0;
      here=upstream.device;
    }
    return 0;
  };
  const remoteCircuit=nearest(ribs.get(remote.id),source,family);
  const remotePort=reverse.source??remoteCircuit?.port;
  if(!remoteCircuit||sourceOn(remote,remotePort,source)!==remoteIp)return {state:'Active (update source mismatch)'};
  const hops=lookup(d,remoteIp,remote),returnHops=lookup(remote,source,d);
  if(!hops||!returnHops||external&&(hops>(setting['ebgp-multihop']??1)||returnHops>(reverse['ebgp-multihop']??1)||
    !setting['ebgp-multihop']&&outgoing.protocol!=='connected'||!reverse['ebgp-multihop']&&remoteCircuit.protocol!=='connected')){
    return {state:'Active (transport unreachable)'};
  }
  return {state:'Established',remote,external,source,remoteIp,setting,reverse,family};
}

const comparison=(a,b)=>
  b.weight-a.weight||b.localPref-a.localPref||Number(b.local)-Number(a.local)||a.asPath.length-b.asPath.length||
  a.origin-b.origin||a.metric-b.metric||Number(b.external)-Number(a.external)||a.nextCost-b.nextCost||comparePeer(a.peer,b.peer);
const comparePeer=(a='',b='')=>{const x=parseV6(a),y=parseV6(b);return x!==null&&y!==null?(x<y?-1:x>y?1:0):(ipv4(a)??0)-(ipv4(b)??0);};

function ownRoutes(d,rib,family,vrf) {
  const {networks,redistribute}=bgpFamily(d,family,vrf);
  const localPref=d.bgp.localPref??100;
  const routes=new Map();
  for(const r of rib) {
    const isNetwork=networks.some(n=>routeKey(n)===routeKey(r));
    const redist=own(redistribute,r.protocol);
    if(!isNetwork&&(!redist||redist.process!==undefined&&r.process!==redist.process))continue;
    const route={destination:r.destination,prefix:r.prefix,local:true,asPath:[],weight:32768,localPref,metric:0,
      nextCost:0,origin:isNetwork?0:2,history:[d.id],tag:r.tag};
    const fromMap=applyPolicy(d,isNetwork?undefined:redist.map,route);
    if(fromMap)routes.set(routeKey(r),fromMap);
  }
  return routes;
}

function exported(from,row,session) {
  const {external,source,setting,remote}=session;
  if(row.history.includes(remote.id)||row.communities?.includes('no-advertise')||external&&row.communities?.includes('no-export'))return null;
  if(!external&&row.clusters?.includes(remote.bgp.clusterId??bgpRouterId(remote)))return null;
  if(!external&&!row.local&&!row.external&&!row.fromClient&&!setting['route-reflector-client'])return null;
  if(setting['prefix-list out']&&!prefixPermits(from,setting['prefix-list out'],row))return null;
  if(setting['filter-list out']&&!pathPermits(from,setting['filter-list out'],row.asPath))return null;
  const isPrivate=as=>as>=64512&&as<=65534||as>=4200000000&&as<=4294967294;
  const remove=external&&setting['remove-private-as'];
  const path=remove&&(remove==='all'||row.asPath.every(isPrivate))?row.asPath.filter(as=>!isPrivate(as)):row.asPath;
  const clusters=!external&&!row.local&&!row.external?[...(row.clusters??[]),from.bgp.clusterId??bgpRouterId(from)]:row.clusters;
  const candidate={...row,local:false,asPath:external?[from.bgp.asn,...path]:path,clusters,
    next:external||row.local||setting['next-hop-self']?source:row.next};
  const changed=applyPolicy(from,setting['route-map out'],candidate);
  return changed?{...changed,communities:setting['send-community']?changed.communities:undefined,
    weight:0,localPref:external?(remote.bgp.localPref??100):changed.localPref}:null;
}

function imported(d,row,session,rib) {
  const {remoteIp,external,setting,family}=session;
  if(row.asPath.includes(d.bgp.asn)||row.clusters?.includes(d.bgp.clusterId??bgpRouterId(d)))return null;
  if(setting['filter-list in']&&!pathPermits(d,setting['filter-list in'],row.asPath))return null;
  if(setting['prefix-list in']&&!prefixPermits(d,setting['prefix-list in'],row))return null;
  const changed=applyPolicy(d,setting['route-map in'],{...row,weight:setting.weight??0});
  if(!changed)return null;
  const via=nearest(rib,changed.next,family);
  if(!via)return null;
  return {...changed,via,peer:remoteIp,external,fromClient:Boolean(setting['route-reflector-client']),
    nextCost:via.metric??0,history:[...row.history,d.id]};
}

export function bgpSnapshot(lab,underlay,family='ipv4',vrf) {
  const enabled=lab.devices.filter(d=>bgpFamily(d,family,vrf)&&(family==='ipv6'?d.ipv6Routing:forwardsIpv4(d)));
  const routers=lab.devices.filter(d=>d.type==='router'||d.type==='switch');
  const ribs=new Map(routers.map(d=>[d.id,underlay(lab,d,vrf)]));
  const state=new Map(enabled.map(d=>{
    const peers=bgpFamily(d,family,vrf);
    return [d.id,{local:ownRoutes(d,ribs.get(d.id),family,vrf),best:null,received:new Map(),
      sessions:Object.keys(peers.neighbors).map(address=>{
        const setting=effectiveNeighbor(peers,address);
        return {address,asn:setting.asn??'—',...sessionFor(lab,d,address,setting,enabled,ribs,family,vrf)};
      })}];
  }));
  for(const device of state.values())device.best=device.local;
  let signature;
  // Re-evaluate the selected paths synchronously until neighbors agree or the graph has been traversed.
  for(let pass=0;pass<=enabled.length*2;pass++){
    const updates=enabled.map(d=>{
      const current=state.get(d.id), best=new Map(current.local),received=new Map();
      for(const session of current.sessions){
        if(!session.remote)continue;
        const peer=state.get(session.remote.id);
        const other=peer.sessions.find(s=>s.address===session.source&&s.remote===d);
        if(!other)continue;
        const routes=[];
        const advertised=[...peer.best.values()];
        const defaultNetwork=family==='ipv6'?'::':'0.0.0.0';
        if(other.setting['default-originate']&&!peer.best.has(defaultNetwork+'/0'))advertised.push({
          destination:defaultNetwork,prefix:0,local:true,asPath:[],weight:32768,localPref:100,origin:0,metric:0,history:[session.remote.id]
        });
        for(const row of advertised) {
          const sent=exported(session.remote,row,other);
          const accepted=sent&&imported(d,sent,session,ribs.get(d.id));
          if(!accepted)continue;
          routes.push(accepted);
          const key=routeKey(accepted), existing=best.get(key);
          if(!existing||comparison(accepted,existing)<0)best.set(key,accepted);
        }
        received.set(session.address,routes);
      }
      return [current,best,received];
    });
    for(const [current,best,received] of updates)Object.assign(current,{best,received});
    const next=JSON.stringify(updates.map(([,best])=>[...best.values()].map(r=>[routeKey(r),r.next,r.weight,r.localPref,r.metric,r.asPath,r.communities,r.history])));
    if(next===signature)break;
    signature=next;
  }
  return state;
}

export function bgpRoutes(lab,d,underlay,family='ipv4',vrf) {
  if(!bgpFamily(d,family,vrf))return [];
  const state=bgpSnapshot(lab,underlay,family,vrf).get(d.id);
  return [...(state?.best.values()??[])].flatMap(r=>r.local?[]:[{
    destination:r.destination,prefix:r.prefix,distance:r.external?20:200,metric:r.metric,port:r.via.port,next:r.via.next??r.next,
    protocol:'bgp',tag:r.tag,process:d.bgp.asn
  }]);
}

function renderRoutes(entries) {
  if(!entries.length)return 'No matching BGP routes.';
  return ['Network              Next Hop          Metric  LocPrf  Weight  Path',
    ...entries.map((row)=>routeKey(row).padEnd(21)+(row.next??'0.0.0.0').padEnd(18)+String(row.metric).padEnd(8)+String(row.localPref).padEnd(8)
      +String(row.weight).padEnd(8)+row.asPath.join(' ')+(row.origin===0?' i':' ?')+(row.communities?.length?'  Community '+row.communities.join(' '):''))].join('\n');
}

export function bgpShow(lab,d,args,underlay) {
  if(!((args[1]==='ip'&&args[2]==='bgp')||args[1]==='bgp'))return null;
  const family=args[2]==='ipv6'?'ipv6':'ipv4';
  const vrf=args[4]==='vrf'?args[5]:undefined;
  const tail=args.slice(args[1]==='ip'?3:vrf?6:4);
  const cfg=bgpFamily(d,family,vrf);
  const state=cfg&&bgpSnapshot(lab,family==='ipv6'?ipv6Underlay:underlay,family,vrf).get(d.id);
  if(!state)return reply('BGP is not running.');
  if(tail[0]==='peer-group')return reply(Object.entries(cfg.peerGroups??{}).filter(([name])=>!tail[1]||tail[1]===name).
    map(([name,row])=>name+'  Remote AS '+(row.asn??'—')+'  '+Object.entries(cfg.neighbors).filter(([,n])=>n.group===name).map(([address])=>address).join(', ')).join('\n')||'No matching BGP peer groups.');
  if(tail[0]==='regexp'){
    const pattern=routingExpression(tail.slice(1).join(' '));
    return pattern?reply(renderRoutes([...state.best.values()].filter(r=>pattern.test(r.asPath.join(' '))))):invalid('Use a bounded Cisco AS-path expression.');
  }
  if(tail[0]==='summary'){
    return reply(['BGP router identifier '+bgpRouterId(d)+', local AS number '+d.bgp.asn+(vrf?', VRF '+vrf:''),
      'Neighbor          AS        State/PfxRcd',...state.sessions.map(s=>s.address.padEnd(18)+String(s.asn).padEnd(10)
        +(s.remote?'Established / '+(state.received.get(s.address)?.length??0):s.state))].join('\n'));
  }
  if(tail[0]==='neighbors'){
    const sessions=state.sessions.filter(row=>!tail[1]||tail[1]===row.address);
    if(tail[2]==='routes')return reply(renderRoutes(state.received.get(tail[1])??[]));
    if(tail[2]==='advertised-routes'){
      const peer=sessions[0];
      return reply(renderRoutes(peer?.remote?[...state.best.values()].map(r=>exported(d,r,peer)).filter(Boolean):[]));
    }
    return reply(sessions.map(s=>'BGP neighbor is '+s.address+', remote AS '+s.asn+'\n  BGP state = '+s.state+
      (s.remote?'\n  Local host '+s.source+', '+(s.external?'external':'internal')+' peer':'')).join('\n')||'No matching BGP neighbors.');
  }
  const filter=tail[0];
  return reply(renderRoutes([...state.best.values()].filter(r=>!filter||routeKey(r)===filter||r.destination===filter)));
}

function configurationRows(table,family,indent) {
  const rows=[];
  for(const [name,spec] of Object.entries(table.peerGroups??{}))rows.push(indent+'neighbor '+name+' peer-group',...neighborRows(name,spec,indent));
  for(const [addr,spec] of Object.entries(table.neighbors))rows.push(...neighborRows(addr,spec,indent));
  for(const network of table.networks)rows.push(indent+'network '+network.destination+(family==='ipv6'?'/'+network.prefix:' mask '+dotted(mask(network.prefix))));
  for(const [key,row] of Object.entries(table.redistribute))rows.push(indent+'redistribute '+key+(row.process?' '+row.process:'')+(row.map?' route-map '+row.map:''));
  return rows;
}

function neighborRows(addr,entry,indent) {
  const stem=indent+'neighbor '+addr+' ';
  return [
    ...(entry.group?[stem+'peer-group '+entry.group]:[]),...(entry.asn?[stem+'remote-as '+entry.asn]:[]),
    ...(entry.source?[stem+'update-source '+entry.source]:[]),...(entry.password?[stem+'password [configured]']:[]),
    ...Object.entries(entry).filter(([key,value])=>!['group','asn','source','password'].includes(key)&&value!==undefined).map(([key,value])=>{
      if(typeof value==='boolean')return value?stem+key:indent+'no neighbor '+addr+' '+key;
      if(key.endsWith(' in')||key.endsWith(' out'))return stem+key.replace(/ (in|out)$/,' '+value+' $1');
      return stem+key+' '+(Array.isArray(value)?value.join(' '):value);
    })
  ];
}

export function bgpRunning(d) {
  const bgp=d.bgp;
  if(!bgp)return [];
  return ['router bgp '+bgp.asn,...(bgp.routerId?[' bgp router-id '+bgp.routerId]:[]),...(bgp.clusterId?[' bgp cluster-id '+bgp.clusterId]:[]),
    ...(bgp.logChanges?[' bgp log-neighbor-changes']:[]),...(bgp.localPref!==undefined?[' bgp default local-preference '+bgp.localPref]:[]),
    ...(bgp.defaultIpv4===false?[' no bgp default ipv4-unicast']:[]),...configurationRows(bgp,'ipv4',' '),
    ...Object.entries(bgp.families??{}).flatMap(([key,table])=>{
      const [family,vrf]=key.split(' ');
      return [' address-family '+family+' unicast'+(vrf?' vrf '+vrf:''),...configurationRows(table,family,'  '),' exit-address-family'];
    })
  ];
}
