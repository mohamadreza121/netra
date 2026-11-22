import { passesUrpf, passesV6Acl } from './packet-policy.js';
import { servicePolicy } from './qos.js';
import { bgpRoutes } from './bgp.js';
import { ospfv3Routes } from './ospfv3.js';
import { deviceById, linkUp, primaryPort, segment } from './network.js';

export function parseV6(text='') {
  if (typeof text!=='string'||!text.includes(':') || !/^[\da-f:]+$/i.test(text)) return null;
  const halves=text.split('::');
  if (halves.length>2) return null;
  const left=halves[0]?halves[0].split(':'):[];
  const right=halves[1]?halves[1].split(':'):[];
  const missing=8-left.length-right.length;
  if (halves.length===1?missing!==0:missing<1) return null;
  const groups=[...left,...Array(missing).fill('0'),...right];
  if (groups.some(group=>!group.length||group.length>4)) return null;
  return groups.reduce((value,group)=>(value<<16n)|BigInt('0x'+group),0n);
}

export function formatV6(value) {
  const groups=Array.from({length:8},(_,i)=>((value>>BigInt(16*(7-i)))&65535n).toString(16));
  let start=-1, length=1;
  for (let i=0;i<8;i++) {
    if (groups[i]!=='0') continue;
    let end=i;
    while (groups[end]==='0') end++;
    if (end-i>length) { start=i; length=end-i; }
    i=end-1;
  }
  return start<0?groups.join(':'):groups.slice(0,start).join(':')+'::'+groups.slice(start+length).join(':');
}

export function parsePrefixV6(text='') {
  const [address, raw, extra]=text.split('/');
  const value=parseV6(address);
  if (value===null || !/^\d{1,3}$/.test(raw??'') || Number(raw)>128 || extra!==undefined) return null;
  return {address:formatV6(value), prefix:Number(raw)};
}

const base=(value,prefix)=>(value>>BigInt(128-prefix))<<BigInt(128-prefix);
export const matchesV6=(a,b,prefix)=>{
  const first=parseV6(a),second=parseV6(b);
  return first!==null&&second!==null&&base(first,prefix)===base(second,prefix);
};
export const linkLocalV6=value=>matchesV6(value,'fe80::',10);
export const networkV6=(address,prefix)=>formatV6(base(parseV6(address),prefix));

export const uplinkV6=d=>d.host.wifi?'WiFi':primaryPort(d);
const physical=(device,port)=>port==='WiFi'?primaryPort(device):port;
const activePorts=device=>device.host.wifi?['WiFi']:Object.keys(device.ports);
export function interfacesV6(device,port) {
  const settings=device.ports[physical(device,port)];
  if(!settings)return [];
  const addresses=settings.ipv6??[];
  if (!(addresses.length||settings.ipv6Enabled)||addresses.some(a=>a.linkLocal)) return addresses;
  return [...addresses,{address:'fe80::'+Number(device.id.slice(1)).toString(16)+':'+(Object.keys(device.ports).indexOf(physical(device,port))+1).toString(16),prefix:64,linkLocal:true}];
}

export const ipv6InterfaceVrf=(d,port)=>d.ports[physical(d,port)]?.vrf;

function connectedV6(lab,d,vrf) {
  return activePorts(d).flatMap(port=>ipv6InterfaceVrf(d,port)===vrf&&linkUp(lab,d,port)?interfacesV6(d,port).filter(r=>!r.linkLocal).map(r=>({
    port,prefix:r.prefix,destination:networkV6(r.address,r.prefix),address:r.address,distance:0,protocol:'connected'
  })):[]);
}

export function staticV6(lab,d,vrf,connected=connectedV6(lab,d,vrf)) {
  return (d.ipv6Routes??[]).filter(route=>route.vrf===vrf).flatMap(route=>{
    const port=(route.port===primaryPort(d)&&d.host.wifi?'WiFi':route.port)??
      connected.filter(c=>matchesV6(route.next,c.destination,c.prefix)).sort((a,b)=>b.prefix-a.prefix)[0]?.port;
    return port&&ipv6InterfaceVrf(d,port)===vrf&&linkUp(lab,d,port)?[{...route,port,protocol:'static'}]:[];
  });
}

function bestV6(routes) {
  const best=new Map();
  for(const row of routes){
    const key=row.destination+'/'+row.prefix,prior=best.get(key);
    if(!prior||row.distance<prior.distance||row.distance===prior.distance&&(row.metric??0)<(prior.metric??0))best.set(key,row);
  }
  return [...best.values()].sort((a,b)=>b.prefix-a.prefix||a.distance-b.distance);
}

export function ipv6Underlay(lab,d,vrf) {
  const connected=connectedV6(lab,d,vrf);
  return bestV6([...connected,...staticV6(lab,d,vrf,connected),...(vrf?[]:ospfv3Routes(lab,d,'ipv6',staticV6))]);
}

export function routesV6(lab,d,vrf) {
  const underlay=ipv6Underlay(lab,d,vrf);
  return d.bgp&&d.ipv6Routing?bestV6([...underlay,...bgpRoutes(lab,d,ipv6Underlay,'ipv6',vrf)]):underlay;
}

export function traceV6(lab,source,ip,from,learn=true,options={}) {
  const normalized=parseV6(ip);
  if(normalized===null)return {ok:false,reason:'Invalid IPv6 address.',path:[source.id]};
  ip=formatV6(normalized);
  const packet={...(options.packet??{protocol:'icmp',icmp:'echo'})};
  let passed=options.count??1;
  let device=source;
  const path=[device.id];
  const visited=new Set();
  let egress, ingress,vrf=options.vrf;
  while (!visited.has(device.id+':'+(vrf??''))) {
    visited.add(device.id+':'+(vrf??''));
    const active=activePorts(device).filter(port=>ipv6InterfaceVrf(device,port)===vrf&&linkUp(lab,device,port));
    if(ingress&&!passesUrpf(device,ingress,'ipv6',from,()=>routesV6(lab,device,vrf),learn)){
      return {ok:false,reason:device.name+': IPv6 source validation dropped traffic.',path};
    }
    if(ingress&&!passesV6Acl(device,ingress,'in',from,ip,packet,learn)){
      return {ok:false,reason:device.name+': input IPv6 ACL denied '+packet.protocol.toUpperCase()+'.',path};
    }
    if(ingress)passed=servicePolicy(device,ingress,'input',packet,from,ip,passed,learn);
    if(!passed)return {ok:false,reason:device.name+': IPv6 input service policy dropped the probe.',path};
    if(active.some(port=>interfacesV6(device,port).some(a=>a.address===ip))){
      if(ingress)passed=servicePolicy(device,'control-plane','input',packet,from,ip,passed,learn);
      return passed?{ok:true,device,from:from??ip,path,egress,ingress,vrf,packets:passed,dscp:packet.dscp??0}:
        {ok:false,reason:device.name+': control-plane service policy dropped the probe.',path};
    }
    if(source!==device&&(!device.ipv6Routing||linkLocalV6(ip)))break;
    const linked=active.filter(port=>interfacesV6(device,port).some(a=>a.linkLocal));
    const onlyLink=options.sourcePort??(from&&active.find(port=>interfacesV6(device,port).some(a=>a.address===from)))??(linked.length===1?linked[0]:undefined);
    const route=linkLocalV6(ip)?(onlyLink?{port:onlyLink}:null):routesV6(lab,device,vrf).find(r=>matchesV6(ip,r.destination,r.prefix));
    if(!route)break;
    const localOnly=linkLocalV6(ip);
    from??=interfacesV6(device,route.port).find(a=>Boolean(a.linkLocal)===localOnly)?.address??
      (!localOnly?active.flatMap(port=>interfacesV6(device,port)).find(a=>!a.linkLocal)?.address:undefined);
    const next=route.next??ip;
    egress??=route.port;
    const hit=segment(lab,device,route.port).find(n=>interfacesV6(n.device,n.port).some(a=>a.address===next));
    if(!hit||!from)break;
    if(!passesV6Acl(device,route.port,'out',from,ip,packet,learn)){
      return {ok:false,reason:device.name+': output IPv6 ACL denied '+packet.protocol.toUpperCase()+'.',path};
    }
    const solicitor=interfacesV6(device,route.port).find(a=>a.linkLocal)?.address??from;
    const ns={protocol:'icmp',icmp:'nd-ns'},na={protocol:'icmp',icmp:'nd-na'};
    if(!passesV6Acl(device,route.port,'out',solicitor,next,ns,learn)||!passesV6Acl(hit.device,hit.port,'in',solicitor,next,ns,learn)||
      !passesV6Acl(hit.device,hit.port,'out',next,solicitor,na,learn)||!passesV6Acl(device,route.port,'in',next,solicitor,na,learn)){
      return {ok:false,reason:device.name+': IPv6 ACL blocked neighbor discovery for '+next+'.',path};
    }
    passed=servicePolicy(device,route.port,'output',packet,from,ip,passed,learn);
    if(!passed)return {ok:false,reason:device.name+': IPv6 output service policy dropped the probe.',path};
    if(learn){
      device.ndCache??={};
      device.ndCache[next]={port:route.port,device:hit.device.id};
    }
    device=hit.device;ingress=hit.port;vrf=ipv6InterfaceVrf(device,ingress);
    path.push(...hit.path.slice(1));
  }
  return {ok:false,reason:device.name+': IPv6 destination unreachable.',path};
}

export function transactionV6(lab,source,ip,{sourceAddress,sourcePort,vrf,learn=false,count,packet={protocol:'icmp',icmp:'echo'}}={}) {
  const forward=traceV6(lab,source,ip,sourceAddress,learn,{sourcePort,vrf,packet,count});
  if(!forward.ok)return forward;
  const reverse=packet.protocol==='icmp'?{...packet,icmp:'echo-reply'}:{
    ...packet,sourcePort:packet.destinationPort,destinationPort:packet.sourcePort,established:packet.protocol==='tcp'
  };
  const back=traceV6(lab,forward.device,forward.from,ip,learn,{sourcePort:forward.ingress,vrf:forward.vrf,packet:reverse,count:forward.packets});
  return back.ok?{...forward,destination:forward.device,packets:back.packets}:{ok:false,reason:'No IPv6 return path. '+back.reason,path:forward.path};
}
export const pingV6=(lab,source,text,options)=>transactionV6(lab,source,text,{...options,learn:true,packet:{protocol:'icmp',icmp:'echo',dscp:options?.dscp,bytes:options?.bytes}});

export function neighborRowsV6(lab,device) {
  return Object.entries(device.ndCache??{}).flatMap(([address,entry])=>{
    const neighbor=deviceById(lab,entry.device);
    return neighbor&&linkUp(lab,device,entry.port)?[address+'  REACH  '+entry.port+'  '+neighbor.name]:[];
  });
}
