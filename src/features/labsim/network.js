import { ospfRoutes } from './ospf.js';
import { permitsPing } from './acl.js';
import { bridgeState, permitsSwitchIngress } from './switching.js';
import { natIn, natOut } from './nat.js';
import { acceptsDhcpOffer, inspectArp, learnDhcp } from './layer2-security.js';

export const deviceLimit = 10;
export const models = {
  router: { title:'Router', prefix:'R', ports:['Gi0/0','Gi0/1','Gi0/2','Gi0/3'], icon:'router' },
  switch: { title:'Switch', prefix:'SW', ports:Array.from({length:8},(_,i)=>'Gi0/'+(i+1)), icon:'switch' },
  pc: { title:'PC', prefix:'PC', ports:['Eth0'], icon:'pc' },
  phone: { title:'IP phone', prefix:'TEL', ports:['Eth0'], icon:'phone' },
  ap: { title:'Wi-Fi AP', prefix:'AP', ports:['Eth0'], icon:'ap' }
};

export const endpoint = (d,port) => ({ device:d.id, port });
export const deviceById = (lab,id) => lab.devices.find(d=>d.id===id);
export const isHost = d => d.type === 'pc' || d.type === 'phone';
export const emptyLab = () => ({ version:1, devices:[], links:[], nextId:1 });

export function addDevice(lab,type) {
  if (!Object.hasOwn(models,type)) throw Error('Unknown device type.');
  const model = models[type];
  const used = lab.devices.filter(d=>d.type===type);
  if (used.length >= deviceLimit) throw Error(`Limit reached: ${deviceLimit} ${model.title} devices per lab.`);
  const slot = Array.from({length:deviceLimit},(_,i)=>i+1).find(n=>!used.some(d=>d.slot===n));
  const pos = Array.from({length:64},(_,i)=>i).find(i=>!lab.devices.some(d=>d.x===position(i).x&&d.y===position(i).y));
  const id = 'n'+lab.nextId++;
  const device = {
    id, type, slot, name:model.prefix+slot, ...position(pos),
    ports:Object.fromEntries(model.ports.map(name=>[name,{ up:type!=='router', mode:'access', vlan:1, native:1 }])),
    vlans:{ 1:'default' }, routes:[], pools:{}, excluded:[],
    host:{},
    radio:{ enabled:false, ssid:'Netra', key:'' }
  };
  lab.devices.push(device);
  return device;
}

function position(index) {
  return { x:8 + index%8*12, y:9+Math.floor(index/8)*11.5 };
}

const equal = (a,b) => a.device===b.device && a.port===b.port;
export function peer(lab,d,port) {
  const local = endpoint(d,port);
  const link = lab.links.find(link=>equal(link.a,local)||equal(link.b,local));
  return link && (equal(link.a,local)?link.b:link.a);
}

export function addLink(lab,a,b) {
  const left=deviceById(lab,a.device);
  const right=deviceById(lab,b.device);
  if (!left || !right || !models[left.type].ports.includes(a.port) || !models[right.type].ports.includes(b.port)) throw Error('Choose two physical Ethernet ports.');
  if (left===right) throw Error('Choose ports on different devices.');
  if (peer(lab,left,a.port)||peer(lab,right,b.port)) throw Error('A port already has a cable. Disconnect it first.');
  lab.links.push({a,b});
}

export function removeDevice(lab,id) {
  lab.devices = lab.devices.filter(d=>d.id!==id);
  lab.links = lab.links.filter(({a,b})=>a.device!==id&&b.device!==id);
  for (const d of lab.devices) {
    if (d.host.wifi?.ap===id) { delete d.host.wifi; delete d.host.lease; }
  }
}

export function restoreLab(serialized) {
  const data = JSON.parse(serialized);
  if (data?.version!==1 || !Array.isArray(data.devices) || !Array.isArray(data.links)
      || !Number.isInteger(data.nextId) || data.nextId<1) throw Error('Unsupported workspace.');
  const restored = emptyLab();
  const ids = new Set();
  const slots = new Set();
  for (const d of data.devices) {
    if (!d || !Object.hasOwn(models,d.type) || !Number.isInteger(d.slot) || d.slot<1 || d.slot>deviceLimit ||
        !/^n[1-9]\d*$/.test(d.id) || Number(d.id.slice(1))>=data.nextId || ids.has(d.id) ||
        slots.has(d.type+d.slot) || !/^[\w-]{1,32}$/.test(d.name) ||
        !Number.isFinite(d.x) || !Number.isFinite(d.y) || d.x<0 || d.x>100 || d.y<0 || d.y>100 ||
        !d.ports || !models[d.type].ports.every(name=>d.ports[name]&&typeof d.ports[name].up==='boolean') ||
        !d.vlans || !Array.isArray(d.routes) || !d.pools || !Array.isArray(d.excluded) || !d.host || !d.radio) {
      throw Error('Invalid saved device.');
    }
    ids.add(d.id); slots.add(d.type+d.slot);
    restored.devices.push(d);
  }
  for(const {a,b} of data.links) addLink(restored,a,b);
  restored.nextId=data.nextId;
  return restored;
}

export function ipv4(text) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text ?? '')) return null;
  const parts=text.split('.').map(Number);
  return parts.some(n=>n>255)?null:parts.reduce((n,v)=>n*256+v,0);
}
export const dotted = value => [24,16,8,0].map(shift=>(value>>>shift)&255).join('.');
export const mask = length => length === 0 ? 0 : (0xffffffff<<(32-length))>>>0;
export function prefixLength(value) {
  if (/^\d{1,2}$/.test(value ?? '') && Number(value)<=32) return Number(value);
  const number=ipv4(value);
  if(number===null) return null;
  for(let i=0;i<=32;i++) if(mask(i)===number)return i;
  return null;
}
const network = (ip,length) => (ipv4(ip)&mask(length))>>>0;
export const inSubnet = (ip, address, length) => ipv4(ip)!==null && ipv4(address)!==null && network(ip,length)===network(address,length);
export const networkAddress = (ip,length) => dotted(network(ip,length));
export const hostIp = d => d.host.lease?.ip ?? d.host.ip;
export const hostPrefix = d => d.host.lease?.prefix ?? d.host.prefix;
export const gateway = d => d.host.lease?.gateway ?? d.host.gateway;

export const parentPort = port => port.split('.')[0];
export function linkUp(lab,d,name) {
  const local=d.ports[name];
  if (!local?.up||local.security?.disabled) return false;
  if (name.startsWith('Lo')) return true;
  if (name.startsWith('Vlan')) {
    const id=Number(name.slice(4));
    return vlanExists(d,id)&&models.switch.ports.some(port=>linkUp(lab,d,port)&&vlanEgress(d.ports[port],id)!==undefined);
  }
  const port=parentPort(name);
  const remote=peer(lab,d,port);
  return Boolean(d.ports[port]?.up&&remote&&deviceById(lab,remote.device)?.ports[remote.port]?.up&&!deviceById(lab,remote.device)?.ports[remote.port]?.security?.disabled);
}

export function wifiUp(lab,host) {
  const association=host.host.wifi;
  const ap=association&&deviceById(lab,association.ap);
  return ap?.radio.enabled && ap.radio.ssid===association.ssid && ap.radio.key===association.key ? ap : null;
}
export function joinWifi(lab,host,ssid,key) {
  const ap=lab.devices.find(d=>d.type==='ap'&&d.radio.enabled&&d.radio.ssid===ssid&&d.radio.key===key);
  if(!ap)return false;
  const clients=lab.devices.filter(d=>d!==host&&isHost(d)&&wifiUp(lab,d)===ap);
  if (clients.length>=(ap.radio.maxClients??50)) return false;
  host.host.wifi={ap:ap.id,ssid,key};
  delete host.host.lease;
  return true;
}

export const vlanExists = (d,vlan) => Object.hasOwn(d.vlans,vlan) && !d.inactiveVlans?.includes(vlan);
const permits = (port,vlan) => !port.allowed || port.allowed.includes(vlan);

export function vlanIngress(port,tag) {
  if(port.mode==='trunk') {
    const vlan=tag??port.native;
    return permits(port,vlan)?vlan:null;
  }
  if(port.mode==='routed')return null;
  return tag===null?port.vlan:tag===port.voice?tag:null;
}

export function vlanEgress(port,vlan) {
  if(port.mode==='trunk')return permits(port,vlan)?(vlan===port.native?null:vlan):undefined;
  if(port.mode==='routed')return undefined;
  if(port.voice===vlan)return vlan;
  return port.vlan===vlan?null:undefined;
}

export function voiceVlan(lab,d) {
  if(d.type!=='phone'||wifiUp(lab,d))return null;
  const wired=peer(lab,d,'Eth0');
  const device=wired&&deviceById(lab,wired.device);
  const port=device?.ports[wired.port];
  return device?.type==='switch'&&port?.mode==='access'?port.voice??null:null;
}

export const macAddress = d => '0200.0000.'+Number(d.id.slice(1)).toString(16).padStart(4,'0');

export function segment(lab,source,port,learn=false,traffic='arp') {
  const results=new Map();
  const seen=new Set();
  const queue=[];
  const learned=new Set();
  const tree=new Map();
  const forwards=(device,port,vlan)=>{
    if (!tree.has(vlan)) tree.set(vlan,bridgeState(lab,vlan));
    const role=tree.get(vlan).get(device.id)?.ports[port];
    return !['Altn','suspended','err-disabled'].includes(role);
  };
  const push=(device,entry,tag,path,hops)=> {
    const key=JSON.stringify([device.id,entry,tag]);
    if(!seen.has(key)){seen.add(key); queue.push({device,entry,tag,path,hops});}
  };
  const transmit=(device,name,tag,path,hops=[])=>{
    if(!linkUp(lab,device,name))return;
    const remote=peer(lab,device,parentPort(name));
    const target=deviceById(lab,remote.device);
    push(target,remote.port,tag,path.concat(target.id),hops);
  };
  const receive=(device,name,path,hops=[])=>{
    if(device!==source&&!results.has(device.id+':'+name))results.set(device.id+':'+name,{device,port:name,path,hops});
  };
  const wireless=(ap,path,hops=[])=>{
    for(const host of lab.devices.filter(isHost)) {
      if(wifiUp(lab,host)===ap) receive(host,'WiFi',path.concat(host.id),hops);
    }
  };

  if(port==='WiFi') {
    const ap=wifiUp(lab,source);
    if(!ap)return [];
    const path=[source.id,ap.id];
    if (!ap.radio.isolation) wireless(ap,path);
    transmit(ap,'Eth0',ap.radio.vlan??null,path);
  } else if (port.startsWith('Vlan')) {
    const vlan=Number(port.slice(4));
    if (linkUp(lab,source,port)) for (const name of models.switch.ports) {
      const tag=vlanEgress(source.ports[name],vlan);
      if (tag!==undefined&&forwards(source,name,vlan)) transmit(source,name,tag,[source.id]);
    }
  } else {
    transmit(source,port,isHost(source)?voiceVlan(lab,source):source.ports[port]?.nativeEncapsulation?null:source.ports[port]?.tag??null,[source.id]);
  }
  for(const {device,entry,tag,path,hops} of queue) {
    if(device.type==='switch') {
      if(device.ports[entry].mode==='routed') {
        if(tag===null)receive(device,entry,path,hops);
        continue;
      }
      const vlan=vlanIngress(device.ports[entry],tag);
      if(vlan===null||!vlanExists(device,vlan)||!forwards(device,entry,vlan)||(learn&&!permitsSwitchIngress(device,entry,source))||(learn&&traffic==='arp'&&!inspectArp(device,entry,vlan,source)))continue;
      if (learn&&!learned.has(device.id+':'+vlan)) {
        learned.add(device.id+':'+vlan);
        device.macTable??={};
        device.macTable[vlan+':'+macAddress(source)]={vlan,mac:macAddress(source),port:entry};
      }
      if (device.ports['Vlan'+vlan]?.up) receive(device,'Vlan'+vlan,path,hops);
      for(const name of models.switch.ports) {
        if(name===entry)continue;
        const outgoing=vlanEgress(device.ports[name],vlan);
        if(outgoing!==undefined&&forwards(device,name,vlan)) transmit(device,name,outgoing,path,learn&&traffic==='dhcp'?[...hops,{device,port:entry,egress:name,vlan}]:hops);
      }
    } else if(device.type==='ap') {
      if (tag===null) receive(device,entry,path,hops);
      if (tag===(device.radio.vlan??null) && device.radio.enabled) wireless(device,path,hops);
    } else if(device.type==='router') {
      for(const [name,p] of Object.entries(device.ports)) {
        if(parentPort(name)===entry && (p.nativeEncapsulation?null:p.tag??null)===tag && p.up && (tag!==null || name!==entry || !Object.entries(device.ports).some(([other,value])=>parentPort(other)===entry && value.nativeEncapsulation))) receive(device,name,path,hops);
      }
    } else if(isHost(device) && !device.host.wifi && voiceVlan(lab,device)===tag) {
      receive(device,entry,path,hops);
    }
  }
  return [...results.values()];
}

const addresses = d=>[...Object.values(d.ports).map(p=>p.address),hostIp(d)].filter(Boolean);
export const interfaceIp = (d,port)=>d.ports[port]?.address??(d.type==='switch'||d.type==='router'?undefined:hostIp(d));

export function connectedRoutes(lab,d) {
  return Object.entries(d.ports)
    .filter(([name,p])=>p.address&&linkUp(lab,d,name))
    .map(([port,p])=>({port,prefix:p.prefix,destination:networkAddress(p.address,p.prefix),distance:0,protocol:'connected'}));
}

export function staticRoutes(lab,d) {
  const connected=connectedRoutes(lab,d);
  return d.routes.flatMap(route=>{
    const next=route.port?(linkUp(lab,d,route.port)&&d.ports[route.port].address?route.port:undefined):
      connected.filter(r=>inSubnet(route.next,r.destination,r.prefix)).sort((a,b)=>b.prefix-a.prefix)[0]?.port;
    return next?[{...route,port:next,protocol:'static'}]:[];
  });
}

export function routeTable(lab,d) {
  const routes=[...connectedRoutes(lab,d),...staticRoutes(lab,d),...ospfRoutes(lab,d,staticRoutes)];
  const best=new Map();
  for (const r of routes) {
    const key=r.destination+'/'+r.prefix;
    if (!best.has(key)||r.distance<best.get(key).distance||(r.distance===best.get(key).distance&&(r.metric??0)<(best.get(key).metric??0)))best.set(key,r);
  }
  return [...best.values()].sort((a,b)=>b.prefix-a.prefix);
}

export function traceIp(lab,source,ip,originalSource,icmp='echo',learn=false,originatingHost) {
  if(ipv4(ip)===null)return {ok:false,reason:'Enter a valid IPv4 address.',path:[source.id]};
  let here=source;
  const visited=new Set();
  const path=[source.id];
  let origin=originalSource;
  let incoming;
  while(!visited.has(here.id)) {
    if (incoming && !permitsPing(here,incoming,'in',origin,ip,icmp)) return {ok:false,reason:here.name+': inbound access list denied ICMP.',path};
    if(learn&&here.ports[incoming]?.nat==='outside')ip=natIn(here,ip,origin,originatingHost);
    if(addresses(here).includes(ip))return {ok:true,destination:here,source:origin??ip,target:ip,path};
    visited.add(here.id);
    let port;
    let next;
    if((here.type==='router'&&here.ipv4Routing!==false)||(here.type==='switch'&&here.ipv4Routing)) {
      const route=routeTable(lab,here).find(r=>inSubnet(ip,r.destination,r.prefix));
      if(!route)return {ok:false,reason:`${here.name}: no route to ${ip}.`,path};
      port=route.port;
      next=route.next??ip;
      origin??=here.ports[port].address;
    } else if(isHost(here)||here.type==='ap'||here.type==='switch') {
      const management=Object.entries(here.ports).find(([name,p])=>p.address&&linkUp(lab,here,name));
      const address=management?.[1].address??hostIp(here);
      if(!address || here!==source)return {ok:false,reason:`${here.name}: configure an IPv4 address or request DHCP.`,path};
      origin??=address;
      port=management?.[0]??(here.host.wifi?'WiFi':'Eth0');
      next=inSubnet(ip,address,management?.[1].prefix??hostPrefix(here))?ip:gateway(here);
      if(!next)return {ok:false,reason:`${here.name}: no default gateway for ${ip}.`,path};
    } else {
      return {ok:false,reason:`${here.name} is a Layer 2 device in this model.`,path};
    }
    if (learn&&here.ports[incoming]?.nat==='inside'&&here.ports[port]?.nat==='outside')origin=natOut(here,origin,ip,icmp);
    if (!permitsPing(here,port,'out',origin,ip,icmp)) return {ok:false,reason:here.name+': outbound access list denied ICMP.',path};
    const neighbor=segment(lab,here,port,learn).find(result=>interfaceIp(result.device,result.port)===next);
    if(!neighbor)return {ok:false,reason:`${here.name}: could not resolve next hop ${next} on ${port}. Check link, VLAN and addressing.`,path};
    if (learn) {
      here.arp??={};
      here.arp[next]={mac:macAddress(neighbor.device),port,device:neighbor.device.id};
    }
    path.push(...neighbor.path.slice(1));
    here=neighbor.device;
    incoming=neighbor.port;
  }
  return {ok:false,reason:'Routing loop detected.',path};
}

export function ping(lab,source,ip) {
  const forward=traceIp(lab,source,ip,undefined,'echo',true);
  if(!forward.ok)return forward;
  const sourceAddress=source.type==='router'?undefined:hostIp(source);
  const back=traceIp(lab,forward.destination,forward.source,forward.target,'echo-reply',true,sourceAddress);
  return back.ok?forward:{ok:false,reason:'No return path. '+back.reason,path:forward.path};
}

export function requestDhcp(lab,host) {
  if(host.host.lease)delete host.host.lease;
  const from=host.host.wifi?'WiFi':'Eth0';
  const neighbors=segment(lab,host,from,true,'dhcp').filter(n=>n.device.type==='router');
  const occupied=new Set(lab.devices.filter(d=>d!==host).flatMap(addresses));
  for(const {device:relay,port,path:localPath,hops} of neighbors) {
    const address=relay.ports[port].address;
    const helper=relay.ports[port].helper;
    const server=helper?traceIp(lab,relay,helper,address):null;
    if (helper&&(!server?.ok||server.destination.type!=='router'||!traceIp(lab,server.destination,address,helper).ok)) continue;
    const device=server?.destination??relay;
    if (device.dhcpDisabled) continue;
    const path=server?[...localPath,...server.path.slice(1)]:localPath;
    const pool=Object.values(device.pools).find(p=>inSubnet(address,p.network,p.prefix));
    if(!pool||pool.prefix>=31||hops.some(h=>!acceptsDhcpOffer(h.device,h.egress,h.vlan)))continue;
    const start=network(pool.network,pool.prefix);
    const last=start+2**(32-pool.prefix)-1;
    const excluded=device.excluded.map(range=>range.map(ipv4));
    for(let n=start+1;n<last;n++) {
      const range=excluded.find(([low,high])=>n>=low&&n<=high);
      if(range){n=range[1];continue;}
      const ip=dotted(n);
      if(occupied.has(ip))continue;
      host.host.lease={ip,prefix:pool.prefix,gateway:pool.gateway,server:device.id,dns:pool.dns,domain:pool.domain};
      for(const h of hops)learnDhcp(h.device,h.port,h.vlan,host,ip);
      return {ok:true,path,ip,server:device.name};
    }
  }
  return {ok:false,path:[host.id],reason:'No DHCP offer. Check the link, VLAN and matching router pool.'};
}

export function branchLab() {
  const lab=emptyLab();
  const [r,sw,pc,phone,ap]=['router','switch','pc','phone','ap'].map(type=>addDevice(lab,type));
  Object.assign(r,{x:22,y:24});
  Object.assign(sw,{x:51,y:24});
  Object.assign(pc,{x:23,y:68});
  Object.assign(phone,{x:51,y:68});
  Object.assign(ap,{x:80,y:68});
  sw.vlans[10]='STAFF'; sw.vlans[20]='VOICE';
  sw.ports['Gi0/1'].mode='trunk';
  sw.ports['Gi0/1'].allowed=[10,20];
  sw.ports['Gi0/2'].vlan=10;
  sw.ports['Gi0/3'].vlan=10;
  sw.ports['Gi0/3'].voice=20;
  sw.ports['Gi0/4'].vlan=10;
  r.ports['Gi0/0'].up=true;
  r.ports['Gi0/0.10']={up:true,tag:10,address:'192.168.10.1',prefix:24};
  r.ports['Gi0/0.20']={up:true,tag:20,address:'192.168.20.1',prefix:24};
  r.pools.STAFF={network:'192.168.10.0',prefix:24,gateway:'192.168.10.1'};
  r.pools.VOICE={network:'192.168.20.0',prefix:24,gateway:'192.168.20.1'};
  r.excluded=[['192.168.10.1','192.168.10.20'],['192.168.20.1','192.168.20.20']];
  phone.host.extension='2001';
  ap.radio={enabled:true,ssid:'Netra-Staff',key:'NetraLab26'};
  [[r,'Gi0/0',sw,'Gi0/1'],[pc,'Eth0',sw,'Gi0/2'],[phone,'Eth0',sw,'Gi0/3'],[ap,'Eth0',sw,'Gi0/4']]
    .forEach(([a,p,b,q])=>addLink(lab,endpoint(a,p),endpoint(b,q)));
  requestDhcp(lab,pc); requestDhcp(lab,phone);
  return lab;
}
