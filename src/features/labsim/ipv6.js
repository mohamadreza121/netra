import { deviceById, linkUp, segment } from './network.js';

export function parseV6(text='') {
  if (!text.includes(':') || !/^[\da-f:]+$/i.test(text)) return null;
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
const same=(a,b,prefix)=>base(parseV6(a),prefix)===base(parseV6(b),prefix);
export const networkV6=(address,prefix)=>formatV6(base(parseV6(address),prefix));

export function interfacesV6(device,port) {
  const settings=device.ports[port];
  if (!settings) return [];
  const addresses=settings.ipv6??[];
  if (!(addresses.length||settings.ipv6Enabled)||addresses.some(a=>a.linkLocal)) return addresses;
  return [...addresses,{address:'fe80::'+Number(device.id.slice(1)).toString(16)+':'+(Object.keys(device.ports).indexOf(port)+1).toString(16),prefix:64,linkLocal:true}];
}

export function routesV6(lab,device) {
  const connected=Object.keys(device.ports).flatMap(port=>linkUp(lab,device,port)?interfacesV6(device,port).filter(r=>!r.linkLocal).map(r=>({
    port, prefix:r.prefix, destination:networkV6(r.address,r.prefix), address:r.address, distance:0
  })):[]);
  return [...connected,...(device.ipv6Routes??[]).flatMap(route=>{
    const port=route.port??connected.find(c=>same(route.next,c.destination,c.prefix))?.port;
    return port&&linkUp(lab,device,port)?[{...route,port}]:[];
  })].sort((a,b)=>b.prefix-a.prefix||a.distance-b.distance);
}

function trace(lab, source, ip, from) {
  let device=source;
  const path=[device.id];
  const visited=new Set();
  while (!visited.has(device.id)) {
    visited.add(device.id);
    const addresses=Object.keys(device.ports).flatMap(port=>linkUp(lab,device,port)?interfacesV6(device,port):[]);
    if (addresses.some(address=>address.address===ip)) return {ok:true,device,from:from??ip,path};
    if (source!==device && !device.ipv6Routing) break;
    const route=routesV6(lab,device).find(r=>same(ip,r.destination,r.prefix));
    if (!route) break;
    from??=interfacesV6(device,route.port).find(a=>!a.linkLocal)?.address;
    const next=route.next??ip;
    const hit=segment(lab,device,route.port).find(n=>interfacesV6(n.device,n.port).some(a=>a.address===next));
    if (!hit || !from) break;
    device.ndCache??={};
    device.ndCache[next]={port:route.port,device:hit.device.id};
    device=hit.device;
    path.push(...hit.path.slice(1));
  }
  return {ok:false,reason:device.name+': IPv6 destination unreachable.',path};
}

export function pingV6(lab,source,text) {
  const ip=formatV6(parseV6(text));
  const forward=trace(lab,source,ip);
  if (!forward.ok) return forward;
  const back=trace(lab,forward.device,forward.from);
  return back.ok?forward:{ok:false,reason:'No IPv6 return path. '+back.reason,path:forward.path};
}

export function neighborRowsV6(lab,device) {
  return Object.entries(device.ndCache??{}).flatMap(([address,entry])=>{
    const neighbor=deviceById(lab,entry.device);
    return neighbor&&linkUp(lab,device,entry.port)?[address+'  REACH  '+entry.port+'  '+neighbor.name]:[];
  });
}
