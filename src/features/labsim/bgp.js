import { forwardsIpv4, dotted, inSubnet, ipv4, linkUp, mask, networkAddress, prefixLength, segment } from './network.js';
import { interfaceName } from './ios.js';
import { applyPolicy, prefixPermits, routeKey } from './route-policy.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const neighbors=[
  'neighbor <peer> activate','no neighbor <peer> activate',
  'neighbor <peer> next-hop-self','no neighbor <peer> next-hop-self',
  'neighbor <peer> weight <weight>','no neighbor <peer> weight',
  'neighbor <peer> route-map <name> in','neighbor <peer> route-map <name> out',
  'no neighbor <peer> route-map <name> in','no neighbor <peer> route-map <name> out',
  'neighbor <peer> prefix-list <name> in','neighbor <peer> prefix-list <name> out',
  'no neighbor <peer> prefix-list <name> in','no neighbor <peer> prefix-list <name> out',
  'neighbor <peer> route-reflector-client','no neighbor <peer> route-reflector-client'
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
    'show bgp ipv4 unicast','show bgp ipv4 unicast summary','show bgp ipv4 unicast neighbors [<address>]','show ip route bgp'],
  global:['router bgp <asn>','no router bgp <asn>'],
  bgp:['bgp router-id <ip>','bgp default local-preference <value>','no bgp default ipv4-unicast','bgp default ipv4-unicast',
    'neighbor <peer> remote-as <asn>','no neighbor <peer>','neighbor <peer> update-source <interface...>','no neighbor <peer> update-source',
    'neighbor <peer> password <key>','no neighbor <peer> password','neighbor <peer> ebgp-multihop [<ttl>]','no neighbor <peer> ebgp-multihop',
    'neighbor <peer> shutdown','no neighbor <peer> shutdown','address-family ipv4 [unicast]',...af],
  bgpAf:['exit-address-family',...af]
};

const validIp=value=>ipv4(value)!==null;
const classful=address=>ipv4(address)>>>24<128?8:ipv4(address)>>>24<192?16:24;
export const bgpRouterId=d=>d.bgp?.routerId??Object.values(d.ports).map(p=>p.address).filter(Boolean).sort((a,b)=>ipv4(b)-ipv4(a))[0]??'0.0.0.0';

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
  if(!['bgp','bgpAf'].includes(s.mode))return null;
  const cfg=d.bgp;
  if(!cfg)return invalid('This BGP process no longer exists.');
  if(c==='exit-address-family'){s.parents?.pop();return enter(s,'bgp',cfg.asn);}
  if(verb==='address-family')return enter(s,'bgpAf',cfg.asn,true);
  if(verb==='bgp'){
    if(sub==='router-id'&&validIp(value)){cfg.routerId=value;return reply();}
    if(sub==='default'&&value==='ipv4-unicast'){cfg.defaultIpv4=!no;return reply();}
    if(sub==='default'&&value==='local-preference'&&integer(option,0,4294967295)){cfg.localPref=Number(option);return reply();}
    return invalid('Check the BGP process settings.');
  }
  if(verb==='network'){
    const prefix=value==='mask'?prefixLength(option):classful(sub);
    if(!validIp(sub)||prefix===null||networkAddress(sub,prefix)!==sub)return invalid('Enter a network and a matching mask.');
    cfg.networks=cfg.networks.filter(r=>r.destination!==sub||r.prefix!==prefix);
    if(!no)cfg.networks.push({destination:sub,prefix});
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
    if(!validIp(sub))return invalid('Enter the IPv4 neighbor address.');
    if(value==='remote-as'){
      if(!integer(option,1,4294967295))return invalid('Enter a valid neighbor AS.');
      if(Object.values(d.ports).some(p=>p.address===sub))return invalid('The neighbor address belongs to this device.');
      cfg.neighbors[sub]={...own(cfg.neighbors,sub),asn:Number(option)};return reply();
    }
    if(no&&!value){delete cfg.neighbors[sub];return reply();}
    const neighbor=own(cfg.neighbors,sub);
    if(!neighbor)return invalid('Configure neighbor remote-as first.');
    if(['activate','next-hop-self','shutdown','route-reflector-client'].includes(value)){neighbor[value]=!no;return reply();}
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
    if(['prefix-list','route-map'].includes(value)&&keyName(option)) {
      const key=value+' '+arg;
      if(no)delete neighbor[key];else neighbor[key]=option;
      return reply();
    }
    return invalid('Check the BGP neighbor settings.');
  }
  return null;
}

function nearest(rib,address) {
  return rib.find(r=>inSubnet(address,r.destination,r.prefix));
}

function sessionFor(lab,d,remoteIp,setting,devices,ribs) {
  if(setting.shutdown||!(setting.activate??d.bgp.defaultIpv4??true))return {state:'Idle (Admin)'};
  const here=ribs.get(d.id);
  const outgoing=nearest(here,remoteIp);
  const sourcePort=setting.source??outgoing?.port;
  const source=sourcePort&&linkUp(lab,d,sourcePort)&&d.ports[sourcePort]?.address;
  if(!source||!outgoing)return {state:'Active (no route)'};
  const remote=devices.find(peer=>peer!==d&&Object.entries(peer.ports).some(([name,p])=>!p.vrf&&p.address===remoteIp&&linkUp(lab,peer,name)));
  if(!remote)return {state:'Active (peer unavailable)'};
  const reverse=own(remote.bgp.neighbors,source);
  const external=d.bgp.asn!==remote.bgp.asn;
  if(!reverse||reverse.asn!==d.bgp.asn||setting.asn!==remote.bgp.asn)return {state:'Active (AS or peer mismatch)'};
  if(reverse.shutdown||!(reverse.activate??remote.bgp.defaultIpv4??true))return {state:'Idle (peer disabled)'};
  if(reverse.password!==setting.password)return {state:'Active (authentication mismatch)'};

  // Verify the IGP forwarding path using its own RIB to avoid making a BGP session depend on itself.
  const lookup=(from,toIp,required)=>{
    let here=from,upstream;
    const visited=new Set();
    while(!visited.has(here.id)) {
      visited.add(here.id);
      if(here===required)return visited.size-1;
      const row=nearest(ribs.get(here.id)??[],toIp);
      if(!row)return 0;
      upstream=segment(lab,here,row.port,false,'control').find(({device,port})=>device.ports[port]?.address===(row.next??toIp));
      if(!upstream)return 0;
      here=upstream.device;
    }
    return 0;
  };
  const remoteCircuit=nearest(ribs.get(remote.id),source);
  const remotePort=reverse.source??remoteCircuit?.port;
  if(!remoteCircuit||remote.ports[remotePort]?.address!==remoteIp)return {state:'Active (update source mismatch)'};
  const hops=lookup(d,remoteIp,remote),returnHops=lookup(remote,source,d);
  if(!hops||!returnHops||external&&(hops>(setting['ebgp-multihop']??1)||returnHops>(reverse['ebgp-multihop']??1)||
    !setting['ebgp-multihop']&&outgoing.protocol!=='connected'||!reverse['ebgp-multihop']&&remoteCircuit.protocol!=='connected')){
    return {state:'Active (transport unreachable)'};
  }
  return {state:'Established',remote,external,source,remoteIp,setting,reverse};
}

const comparison=(a,b)=>
  b.weight-a.weight||b.localPref-a.localPref||Number(b.local)-Number(a.local)||a.asPath.length-b.asPath.length||
  a.origin-b.origin||a.metric-b.metric||Number(b.external)-Number(a.external)||a.nextCost-b.nextCost||ipv4(a.peer??'0.0.0.0')-ipv4(b.peer??'0.0.0.0');

function ownRoutes(d,rib) {
  const {networks,redistribute,localPref=100}=d.bgp;
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
  if(row.history.includes(remote.id))return null;
  if(!external&&!row.local&&!row.external&&!row.fromClient&&!setting['route-reflector-client'])return null;
  if(setting['prefix-list out']&&!prefixPermits(from,setting['prefix-list out'],row))return null;
  const candidate={...row,local:false,asPath:external?[from.bgp.asn,...row.asPath]:row.asPath,
    next:external||row.local||setting['next-hop-self']?source:row.next};
  const changed=applyPolicy(from,setting['route-map out'],candidate);
  return changed?{...changed,weight:0,localPref:external?(remote.bgp.localPref??100):changed.localPref}:null;
}

function imported(d,row,session,rib) {
  const {remoteIp,external,setting}=session;
  if(row.asPath.includes(d.bgp.asn))return null;
  if(setting['prefix-list in']&&!prefixPermits(d,setting['prefix-list in'],row))return null;
  const changed=applyPolicy(d,setting['route-map in'],{...row,weight:setting.weight??0});
  if(!changed)return null;
  const via=nearest(rib,changed.next);
  if(!via)return null;
  return {...changed,via,peer:remoteIp,external,fromClient:Boolean(setting['route-reflector-client']),
    nextCost:via.metric??0,history:[...row.history,d.id]};
}

export function bgpSnapshot(lab,underlay) {
  const enabled=lab.devices.filter(d=>d.bgp?.asn&&forwardsIpv4(d));
  const ribs=new Map(lab.devices.filter(d=>d.type==='router'||d.type==='switch').map(d=>[d.id,underlay(lab,d)]));
  const state=new Map(enabled.map(d=>[d.id,{
    local:ownRoutes(d,ribs.get(d.id)),best:null, received:new Map(),
    sessions:Object.entries(d.bgp.neighbors).map(([address,setting])=>({address,asn:setting.asn,...sessionFor(lab,d,address,setting,enabled,ribs)}))
  }]));
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
        for(const row of peer.best.values()) {
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
    const next=JSON.stringify(updates.map(([,best])=>[...best.values()].map(r=>[routeKey(r),r.next,r.weight,r.localPref,r.metric,r.asPath,r.history])));
    if(next===signature)break;
    signature=next;
  }
  return state;
}

export function bgpRoutes(lab,d,underlay) {
  if(!d.bgp)return [];
  const state=bgpSnapshot(lab,underlay).get(d.id);
  return [...(state?.best.values()??[])].flatMap(r=>r.local?[]:[{
    destination:r.destination,prefix:r.prefix,distance:r.external?20:200,metric:r.metric,port:r.via.port,next:r.via.next??r.next,
    protocol:'bgp',tag:r.tag,process:d.bgp.asn
  }]);
}

function renderRoutes(entries) {
  if(!entries.length)return 'No matching BGP routes.';
  return ['Network              Next Hop          Metric  LocPrf  Weight  Path',
    ...entries.map((row)=>routeKey(row).padEnd(21)+(row.next??'0.0.0.0').padEnd(18)+String(row.metric).padEnd(8)+String(row.localPref).padEnd(8)
      +String(row.weight).padEnd(8)+row.asPath.join(' ')+(row.origin===0?' i':' ?'))].join('\n');
}

export function bgpShow(lab,d,args,underlay) {
  if(!((args[1]==='ip'&&args[2]==='bgp')||args[1]==='bgp'))return null;
  const tail=args.slice(args[1]==='ip'?3:4);
  const state=d.bgp&&bgpSnapshot(lab,underlay).get(d.id);
  if(!state)return reply('BGP is not running.');
  if(tail[0]==='summary'){
    return reply(['BGP router identifier '+bgpRouterId(d)+', local AS number '+d.bgp.asn,
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

export function bgpRunning(d) {
  const b=d.bgp;
  if(!b)return [];
  return ['router bgp '+b.asn,...(b.routerId?[' bgp router-id '+b.routerId]:[]),
    ...(b.localPref!==undefined?[' bgp default local-preference '+b.localPref]:[]),...(b.defaultIpv4===false?[' no bgp default ipv4-unicast']:[]),
    ...Object.entries(b.neighbors).flatMap(([address,n])=>[' neighbor '+address+' remote-as '+n.asn,
      ...(n.source?[' neighbor '+address+' update-source '+n.source]:[]),...(n.password?[' neighbor '+address+' password [configured]']:[]),
      ...Object.entries(n).filter(([key,v])=>!['asn','source','password'].includes(key)&&v!==undefined)
        .map(([key,v])=>typeof v==='boolean'?' '+(v?'':'no ')+'neighbor '+address+' '+key:
          ' neighbor '+address+' '+(key.endsWith(' in')||key.endsWith(' out')?key.replace(/ (in|out)$/,' '+v+' $1'):key+' '+v))]),
    ...b.networks.map(n=>' network '+n.destination+' mask '+dotted(mask(n.prefix))),
    ...Object.entries(b.redistribute).map(([key,r])=>' redistribute '+key+(r.process?' '+r.process:'')+(r.map?' route-map '+r.map:''))];
}
