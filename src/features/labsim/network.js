import { policyNext } from './route-policy.js';
import { raGuardRejects } from './ipv6-services.js';
import { observeFlows } from './netflow.js';
import { nhrpNext, recordTunnel, tunnelPeers, tunnelState } from './gre.js';
import { trackedUp, virtualGateway } from './availability.js';
import { managementPort, wifiSession, wlcTag } from './wireless-controller.js';
import { accessState } from './identity.js';
import { passesUrpf } from './packet-policy.js';
import { vpnRoutes } from './mpls.js';
import { servicePolicy } from './qos.js';
import { ospfv3Routes } from './ospfv3.js';
import { bgpRoutes } from './bgp.js';
import { eigrpRoutes } from './eigrp.js';
import { ospfRoutes } from './ospf.js';
import { permitsPacket } from './acl.js';
import { channelPort, operationalPort, vlanDatabase, vtpPruned } from './campus.js';
import { bridgeState, memberPorts, permitsSwitchIngress, restoreChannelPorts } from './switching.js';
import { natIn, natOut } from './nat.js';
import { acceptsDhcpOffer, inspectArp, learnDhcp } from './layer2-security.js';

import { capacity, deviceLimit, models, isHost, isEndpoint, primaryPort } from './platforms.js';

export { capacity, deviceLimit, models, isHost, isEndpoint, primaryPort };

export const forwardsIpv4 = d=>d.type==='router'?d.ipv4Routing!==false:d.type==='switch'&&Boolean(d.ipv4Routing);

export const endpoint = (d,port) => ({ device:d.id, port });
export const deviceById = (lab,id) => lab.devices.find(d=>d.id===id);
export const emptyLab = () => ({ version:1, devices:[], links:[], nextId:1 });
const defaultPort=type=>({up:type!=='router',mode:'access',vlan:1,native:1});

export function addDevice(lab,type) {
  if (!Object.hasOwn(models,type)) throw Error('Unknown device type.');
  const model = models[type];
  const used = lab.devices.filter(d=>d.type===type);
  if (used.length >= deviceLimit) throw Error(`Limit reached: ${deviceLimit} ${model.title} devices per lab.`);
  const slot = Array.from({length:deviceLimit},(_,i)=>i+1).find(n=>!used.some(d=>d.slot===n));
  const pos = Array.from({length:capacity},(_,i)=>i).find(i=>!lab.devices.some(d=>d.x===position(i).x&&d.y===position(i).y));
  const id = 'n'+lab.nextId++;
  const device = {
    id, type, slot, name:model.prefix+slot, ...position(pos),
    ports:Object.fromEntries(model.ports.map(name=>[name,defaultPort(type)])),
    vlans:{ 1:'default' }, routes:[], pools:{}, excluded:[],
    host:{},
    radio:{ enabled:false, ssid:'Netra', key:'' }
  };
  lab.devices.push(device);
  return device;
}

function position(index) {
  return {x:6+(index%10)*(88/9),y:7+Math.floor(index/10)*(86/7)};
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
        !d.ports || !models[d.type].ports.every((name,index)=>
          typeof d.ports[name]?.up==='boolean'||d.type==='switch'&&index>=8&&!Object.hasOwn(d.ports,name)) ||
        !d.vlans || !Array.isArray(d.routes) || !d.pools || !Array.isArray(d.excluded) || !d.host || !d.radio) {
      throw Error('Invalid saved device.');
    }
    ids.add(d.id); slots.add(d.type+d.slot);
    for(const name of models[d.type].ports)d.ports[name]??=defaultPort(d.type);
    restoreChannelPorts(d);
    restored.devices.push(d);
  }
  for(const {a,b} of data.links) addLink(restored,a,b);
  restored.nextId=data.nextId;
  if(['enterprise','branch','routing','provider-vpn','dmvpn'].includes(data.scenario))restored.scenario=data.scenario;
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
  if(name==='WiFi')return Boolean(wifiUp(lab,d));
  const local=d.ports[name];
  if (!local?.up||local.security?.disabled) return false;
  if(name.startsWith('Po'))return memberPorts(lab,d,name).length>0;
  if(name.startsWith('Tu'))return Boolean(tunnelState(lab,d,name));
  if (name.startsWith('Lo')) return true;
  if (name.startsWith('Vlan')) {
    const id=Number(name.slice(4));
    if(d.type==='wlc')return linkUp(lab,d,primaryPort(d));
    return vlanExists(d,id,lab)&&models.switch.ports.some(port=>linkUp(lab,d,port)&&vlanEgress(operationalPort(lab,d,port),id)!==undefined&&
      (!d.ports[port].channel||memberPorts(lab,d,channelPort(d,port)).includes(port)));
  }
  const port=parentPort(name);
  const remote=peer(lab,d,port);
  return Boolean(d.ports[port]?.up&&remote&&deviceById(lab,remote.device)?.ports[remote.port]?.up&&!deviceById(lab,remote.device)?.ports[remote.port]?.security?.disabled);
}

export const wifiUp = (lab,host) => wifiSession(lab,host)?.ap??null;

export function vlanExists(d,vlan,lab) {
  const {vlans,inactive}=vlanDatabase(lab,d);
  return Object.hasOwn(vlans,vlan)&&!inactive.includes(vlan);
}
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
  if(d.type!=='phone'||d.host.wifi)return null;
  const wired=peer(lab,d,'Eth0');
  const device=wired&&deviceById(lab,wired.device);
  const port=device?.type==='switch'?operationalPort(lab,device,wired.port):null;
  return device?.type==='switch'&&port?.mode==='access'?port.voice??null:null;
}

export const macAddress = d => '0200.0000.'+Number(d.id.slice(1)).toString(16).padStart(4,'0');

export function segment(lab,source,port,learn=false,traffic='arp') {
  if(port.startsWith('Tu')){
    return tunnelPeers(lab,source,port,{multicast:traffic==='control',includeShortcuts:traffic!=='control'}).
      map(peer=>({...peer,hops:[]}));
  }
  const results=new Map();
  const seen=new Set();
  const queue=[];
  const learned=new Set();
  const tree=new Map();
  const forwards=(device,port,vlan)=>{
    if (!tree.has(vlan)) tree.set(vlan,bridgeState(lab,vlan));
    const role=tree.get(vlan).get(device.id)?.ports[port];
    return !['Altn','suspended','err-disabled','root-inconsistent','loop-inconsistent'].includes(role);
  };
  const push=(device,entry,tag,path,hops)=> {
    const key=JSON.stringify([device.id,entry,tag]);
    if(!seen.has(key)){seen.add(key); queue.push({device,entry,tag,path,hops});}
  };
  const transmit=(device,name,tag,path,hops=[])=>{
    if(!linkUp(lab,device,name))return;
    const logical=name.startsWith('Po')?name:device.type==='switch'?channelPort(device,name):name;
    let physical=parentPort(name);
    if(logical.startsWith('Po')){
      const members=memberPorts(lab,device,logical);
      let key=device.lagHash?.includes('ip')?(hostIp(source)??source.ports[port]?.address??source.id):macAddress(source);
      if(device.lagHash?.startsWith('dst'))key=device.id+':'+tag;
      if(!members.length)return;
      if(name===logical)physical=members[[...key].reduce((hash,ch)=>(hash*31+ch.charCodeAt(0))>>>0,0)%members.length];
      else if(!members.includes(name))return;
    }
    const remote=peer(lab,device,physical);
    if(!remote)return;
    const target=deviceById(lab,remote.device);
    push(target,remote.port,tag,path.concat(target.id),hops);
  };
  const receive=(device,name,path,hops=[])=>{
    if(device!==source&&!results.has(device.id+':'+name))results.set(device.id+':'+name,{device,port:name,path,hops});
  };
  const effective=(device,name)=>{
    const auth=accessState(lab,device,name);
    const port=operationalPort(lab,device,name);
    return auth.allowed?(auth.vlan?{...port,vlan:auth.vlan}:port):null;
  };
  const wireless=(bridge,tag,path,hops=[],origin)=>{
    if(traffic==='control')return;
    for(const host of lab.devices) {
      if(!host.host.wifi||!isHost(host))continue;
      const session=wifiSession(lab,host);
      if(session?.bridge!==bridge||dataTag(session)!==tag)continue;
      if(origin&&(origin.ssid!==session.ssid||origin.ap.radio.isolation))continue;
      const through=session.ap!==bridge&&!path.includes(session.ap.id)?[session.ap.id]:[];
      receive(host,'WiFi',path.concat(through,host.id),hops);
    }
  };
  const dataTag=session=>session.bridge.type==='wlc'?wlcTag(session.bridge,session.vlan):session.vlan??null;

  if(port==='WiFi') {
    if(traffic==='control')return [];
    const session=wifiSession(lab,source);
    if(!session)return [];
    const {ap,bridge}=session;
    const path=[source.id,ap.id,...(bridge===ap?[]:[bridge.id])];
    wireless(bridge,dataTag(session),path,[],session);
    transmit(bridge,primaryPort(bridge),dataTag(session),path);
  } else if (source.type==='wlc'&&port.startsWith('Vlan')) {
    if(linkUp(lab,source,port))transmit(source,primaryPort(source),wlcTag(source,Number(port.slice(4))),[source.id]);
  } else if (port.startsWith('Vlan')) {
    const vlan=Number(port.slice(4));
    if (linkUp(lab,source,port)) for (const name of models.switch.ports) {
      const p=effective(source,name);
      const tag=p?vlanEgress(p,vlan):undefined;
      if (tag!==undefined&&forwards(source,name,vlan)&&!vtpPruned(lab,source,name,vlan)) transmit(source,name,tag,[source.id]);
    }
  } else {
    transmit(source,port,isHost(source)?voiceVlan(lab,source):source.ports[port]?.nativeEncapsulation?null:source.ports[port]?.tag??null,[source.id]);
  }
  for(const {device,entry,tag,path,hops} of queue) {
    if(device.type==='switch') {
      if(traffic==='ra'&&raGuardRejects(device,entry))continue;
      const iface=channelPort(device,entry);
      if(iface!==entry&&!memberPorts(lab,device,iface).includes(entry))continue;
      if(operationalPort(lab,device,entry).mode==='routed') {
        if(tag===null)receive(device,iface,path,hops);
        continue;
      }
      const p=effective(device,entry);
      const vlan=p?vlanIngress(p,tag):null;
      if(vlan===null||!vlanExists(device,vlan,lab)||!forwards(device,entry,vlan)||(learn&&!permitsSwitchIngress(device,entry,source))||(learn&&traffic==='arp'&&!inspectArp(device,entry,vlan,source)))continue;
      if (learn&&!learned.has(device.id+':'+vlan)) {
        learned.add(device.id+':'+vlan);
        device.macTable??={};
        device.macTable[vlan+':'+macAddress(source)]={vlan,mac:macAddress(source),port:iface};
      }
      if (device.ports['Vlan'+vlan]?.up) receive(device,'Vlan'+vlan,path,hops);
      const sent=new Set();
      for(const name of models.switch.ports) {
        const output=channelPort(device,name);
        if(output===iface||sent.has(output))continue;
        const p=effective(device,name);
        const outgoing=p?vlanEgress(p,vlan):undefined;
        if(outgoing===undefined||!forwards(device,name,vlan)||vtpPruned(lab,device,name,vlan))continue;
        if(output!==name&&(!linkUp(lab,device,output)||!memberPorts(lab,device,output).includes(name)))continue;
        sent.add(output);
        transmit(device,output,outgoing,path,learn&&traffic==='dhcp'?[...hops,{device,port:entry,egress:name,vlan}]:hops);
      }
    } else if(device.type==='ap') {
      if (tag===null) receive(device,entry,path,hops);
      if (device.radio.enabled) wireless(device,tag,path,hops);
    } else if(device.type==='wlc') {
      const management=managementPort(device);
      const expected=management.startsWith('Vlan')?wlcTag(device,Number(management.slice(4))):null;
      if(tag===expected&&device.ports[management]?.up)receive(device,management,path,hops);
      wireless(device,tag,path,hops);
    } else if(device.type==='router') {
      for(const [name,p] of Object.entries(device.ports)) {
        if(parentPort(name)===entry && (p.nativeEncapsulation?null:p.tag??null)===tag && p.up && (tag!==null || name!==entry || !Object.entries(device.ports).some(([other,value])=>parentPort(other)===entry && value.nativeEncapsulation))) receive(device,name,path,hops);
      }
    } else if(isEndpoint(device) && !device.host.wifi && voiceVlan(lab,device)===tag) {
      receive(device,entry,path,hops);
    }
  }
  return [...results.values()];
}

export const addresses = d=>[...Object.values(d.ports).map(p=>p.address),hostIp(d)].filter(Boolean);
export const interfaceIp = (d,port)=>d.ports[port]?.address??(d.type==='switch'||d.type==='router'?undefined:hostIp(d));

export function connectedRoutes(lab,d,vrf,noTunnels=false) {
  return Object.entries(d.ports)
    .filter(([name,p])=>(!noTunnels||!name.startsWith('Tu'))&&p.vrf===vrf&&p.address&&linkUp(lab,d,name))
    .map(([port,p])=>({port,prefix:p.prefix,destination:networkAddress(p.address,p.prefix),distance:0,protocol:'connected'}));
}

export function staticRoutes(lab,d,vrf,baseOnly=false,noTunnels=false) {
  const connected=connectedRoutes(lab,d,vrf,noTunnels);
  const candidates=d.routes.filter(row=>row.vrf===vrf&&(!noTunnels||!row.port?.startsWith('Tu'))&&(!row.track||!baseOnly&&trackedUp(lab,d,row.track)));
  return candidates.flatMap(route=>{
    const resolve=(row,seen)=>{
      if(row.port)return d.ports[row.port]?.vrf===vrf&&linkUp(lab,d,row.port)&&d.ports[row.port].address?{port:row.port}:null;
      const directly=connected.find(r=>inSubnet(row.next,r.destination,r.prefix));
      if(directly)return {port:directly.port,next:row.next};
      const parent=candidates.filter(r=>r!==row&&!seen.includes(r)&&inSubnet(row.next,r.destination,r.prefix))
        .sort((a,b)=>b.prefix-a.prefix||a.distance-b.distance)[0];
      if(!parent)return null;
      const found=resolve(parent,[...seen,row]);
      return found?{port:found.port,next:found.next??row.next}:null;
    };
    const resolved=resolve(route,[]);
    return resolved?[{...route,...resolved,protocol:'static'}]:[];
  });
}

function selectRoutes(routes) {
  const best=new Map();
  for(const r of routes){
    const key=r.destination+'/'+r.prefix;
    if(!best.has(key)||r.distance<best.get(key).distance||r.distance===best.get(key).distance&&(r.metric??0)<(best.get(key).metric??0))best.set(key,r);
  }
  return [...best.values()].sort((a,b)=>b.prefix-a.prefix);
}

const staticUnderlay=(lab,d)=>[...connectedRoutes(lab,d),...staticRoutes(lab,d)];
const ospfInputs=(lab,d)=>[...staticUnderlay(lab,d),...eigrpRoutes(lab,d,staticUnderlay)];
export const eigrpInputs=(lab,d)=>[...staticUnderlay(lab,d),...ospfRoutes(lab,d,staticRoutes)];
export function ipv4Underlay(lab,d,vrf) {
  if(vrf)return selectRoutes([...connectedRoutes(lab,d,vrf),...staticRoutes(lab,d,vrf)]);
  const routes=staticUnderlay(lab,d);
  if(!forwardsIpv4(d))return selectRoutes(routes);
  return selectRoutes([...routes,...ospfRoutes(lab,d,staticRoutes,ospfInputs),...ospfv3Routes(lab,d,'ipv4',staticRoutes),...eigrpRoutes(lab,d,eigrpInputs)]);
}

export function routeTable(lab,d,vrf) {
  const base=ipv4Underlay(lab,d,vrf);
  return forwardsIpv4(d)&&d.bgp?selectRoutes([...base,...bgpRoutes(lab,d,ipv4Underlay,'ipv4',vrf),...(vrf?vpnRoutes(lab,d,vrf):[])]):base;
}

export function traceIp(lab,source,ip,originalSource,icmp='echo',learn=false,originatingHost,options={}) {
  if(ipv4(ip)===null)return {ok:false,reason:'Enter a valid IPv4 address.',path:[source.id]};
  let here=source;
  const visited=new Set();
  const path=[source.id];
  let origin=originalSource;
  let incoming, arrivedAtGateway;
  const packet={...(options.packet??{protocol:'icmp',icmp})};
  let passed=options.count??1;
  const observe=learn||Boolean(options.observe);
  let vrf=options.vrf;
  const localAddress=()=>arrivedAtGateway||Object.entries(here.ports).some(([name,p])=>(!options.noTunnels||!name.startsWith('Tu'))&&p.vrf===vrf&&p.address===ip&&linkUp(lab,here,name))||
    vrf===undefined&&hostIp(here)===ip;
  while(!visited.has(here.id+':'+(vrf??''))) {
    if(!options.control&&incoming&&!passesUrpf(here,incoming,'ip',origin,()=>routeTable(lab,here,vrf),observe)){
      return {ok:false,reason:here.name+': IPv4 source validation dropped traffic.',path};
    }
    if (!options.control && incoming && !permitsPacket(here,incoming,'in',origin,ip,packet,!options.wiredOnly)) return {ok:false,reason:here.name+': inbound access list denied '+packet.protocol.toUpperCase()+'.',path};
    if(learn&&here.ports[incoming]?.nat==='outside')ip=natIn(here,ip,origin,originatingHost);
    const capture=out=>{if(observe)observeFlows(lab,here,incoming,out,{...packet,source:origin??ip,destination:ip},passed);};
    if(!options.wiredOnly&&incoming)passed=servicePolicy(here,incoming,'input',packet,origin,ip,passed,observe);
    if(localAddress()){
      if(!options.wiredOnly&&incoming)passed=servicePolicy(here,'control-plane','input',packet,origin,ip,passed,observe);
      if(!passed)return {ok:false,reason:here.name+': service policy dropped the probe.',path};
      capture();return {ok:true,destination:here,source:origin??ip,target:ip,path,vrf,packets:passed,dscp:packet.dscp??0};
    }
    if(!passed)return {ok:false,reason:here.name+': input service policy dropped the probe.',path};
    visited.add(here.id+':'+(vrf??''));
    let port;
    let next;
    if(forwardsIpv4(here)) {
      const table=options.baseOnly?selectRoutes([...connectedRoutes(lab,here,vrf,options.noTunnels),...staticRoutes(lab,here,vrf,true,options.noTunnels)]):routeTable(lab,here,vrf);
      const policy=incoming?here.ports[incoming]?.policy:here.localPolicy;
      const override=!options.baseOnly&&policy&&policyNext(lab,here,policy,origin,ip,packet,table.filter(r=>r.protocol==='connected'));
      const route=override||table.find(r=>inSubnet(ip,r.destination,r.prefix));
      if(!route)return {ok:false,reason:`${here.name}: no route to ${ip}.`,path};
      if(route.vpn){
        origin??=Object.entries(here.ports).find(([name,p])=>p.vrf===vrf&&p.address&&linkUp(lab,here,name))?.[1].address;
        if(!origin)return {ok:false,reason:here.name+': assign a source address in the VRF.',path};
        capture(route.port);
        path.push(...route.vpn.path.slice(1));
        here=deviceById(lab,route.vpn.remote);
        vrf=route.vpn.vrf;incoming=undefined;arrivedAtGateway=false;
        continue;
      }
      port=route.port;
      next=route.next??ip;
      origin??=here.ports[port].address;
    } else if(isEndpoint(here)||here.type==='switch') {
      const management=Object.entries(here.ports).find(([name,p])=>p.vrf===vrf&&p.address&&linkUp(lab,here,name)&&(here.type!=='wlc'||name===managementPort(here)));
      const address=management?.[1].address??hostIp(here);
      if(!address || here!==source)return {ok:false,reason:`${here.name}: configure an IPv4 address or request DHCP.`,path};
      origin??=address;
      port=management?.[0]??(here.host.wifi?'WiFi':primaryPort(here));
      next=inSubnet(ip,address,management?.[1].prefix??hostPrefix(here))?ip:gateway(here);
      if(!next)return {ok:false,reason:`${here.name}: no default gateway for ${ip}.`,path};
    } else {
      return {ok:false,reason:`${here.name} is a Layer 2 device in this model.`,path};
    }
    if (learn&&here.ports[incoming]?.nat==='inside'&&here.ports[port]?.nat==='outside')origin=natOut(here,origin,ip,icmp);
    if (!options.control && !permitsPacket(here,port,'out',origin,ip,packet,!options.wiredOnly)) return {ok:false,reason:here.name+': outbound access list denied '+packet.protocol.toUpperCase()+'.',path};
    const segmentDevices=segment(lab,here,port,learn,options.wiredOnly?'control':'arp');
    const neighbor=(port.startsWith('Tu')&&nhrpNext(lab,here,port,next,ip,learn))||segmentDevices.find(result=>interfaceIp(result.device,result.port)===next)
      ||virtualGateway(lab,segmentDevices,next,!options.baseOnly);
    if(!neighbor)return {ok:false,reason:`${here.name}: could not resolve next hop ${next} on ${port}. Check link, VLAN and addressing.`,path};
    if(!options.wiredOnly)passed=servicePolicy(here,port,'output',packet,origin,ip,passed,observe);
    if(!passed)return {ok:false,reason:here.name+': output service policy dropped the probe.',path};
    if(port.startsWith('Tu')&&learn&&neighbor.sa)recordTunnel(here,port,neighbor,passed);
    capture(port);
    if (learn) {
      here.arp??={};
      here.arp[next]={mac:macAddress(neighbor.device),port,device:neighbor.device.id};
    }
    path.push(...neighbor.path.slice(1));
    here=neighbor.device;
    incoming=neighbor.port;
    arrivedAtGateway=neighbor.virtual&&next===ip;
    vrf=here.ports[incoming]?.vrf;
  }
  return {ok:false,reason:'Routing loop detected.',path};
}

export function ping(lab,source,ip,{sourceAddress,vrf,count,dscp,bytes}={}) {
  const forward=traceIp(lab,source,ip,sourceAddress,'echo',true,undefined,{vrf,count,packet:{protocol:'icmp',icmp:'echo',dscp,bytes}});
  if(!forward.ok)return forward;
  const originalHost=source.type==='router'?undefined:hostIp(source);
  const back=traceIp(lab,forward.destination,forward.source,forward.target,'echo-reply',true,originalHost,{vrf:forward.vrf,count:forward.packets});
  return back.ok?{...forward,packets:back.packets}:{ok:false,reason:'No return path. '+back.reason,path:forward.path};
}

export function transaction(lab,source,address,{sourceAddress,control=false,wiredOnly=false,packet,baseOnly=false,noTunnels=false,observe=false}={}) {
  const options={control,wiredOnly,packet,baseOnly,noTunnels,observe};
  const forward=traceIp(lab,source,address,sourceAddress,'echo',false,undefined,options);
  if(!forward.ok)return forward;
  const response=packet&&{...packet,sourcePort:packet.destinationPort,destinationPort:packet.sourcePort,established:packet.protocol==='tcp'};
  const reverse=traceIp(lab,forward.destination,forward.source,address,'echo-reply',false,undefined,{...options,packet:response,vrf:forward.vrf});
  return reverse.ok?forward:{ok:false,path:forward.path,reason:'No return path. '+reverse.reason};
}

export function requestDhcp(lab,host) {
  if(host.host.lease)delete host.host.lease;
  const from=host.host.wifi?'WiFi':primaryPort(host);
  const neighbors=segment(lab,host,from,true,'dhcp');
  const occupied=new Set(lab.devices.filter(d=>d!==host).flatMap(addresses));
  for(const {device:relay,port,path:localPath,hops} of neighbors) {
    const address=interfaceIp(relay,port);
    if(!address)continue;
    const helper=relay.ports[port]?.helper;
    const server=helper?transaction(lab,relay,helper,{sourceAddress:address,packet:{protocol:'udp',sourcePort:67,destinationPort:67}}):null;
    if (helper&&!server?.ok) continue;
    const device=server?.destination??relay;
    if (!(device.type==='router'||device.type==='switch'||device.type==='server'&&device.services?.dhcp) || device.dhcpDisabled) continue;
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
      host.host.lease={ip,prefix:pool.prefix,gateway:pool.gateway,server:device.id,dns:pool.dns,domain:pool.domain,tftp:pool.tftp};
      for(const h of hops)learnDhcp(h.device,h.port,h.vlan,host,ip);
      return {ok:true,path,ip,server:device.name};
    }
  }
  return {ok:false,path:[host.id],reason:'No DHCP offer. Check the link, VLAN and matching DHCP scope.'};
}

export function branchLab() {
  const lab={...emptyLab(),scenario:'branch'};
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
