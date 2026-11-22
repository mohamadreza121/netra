import { negotiateIpsec } from './ipsec.js';
import { inSubnet, ipv4, linkUp, transaction } from './network.js';
import { interfaceName } from './ios.js';
import { integer, invalid, keyName, own, reply } from './cli-utils.js';

export const greIOS={
  operational:['show tunnel interface <interface...>','show dmvpn [detail]','show ip nhrp',
    'show ip nhrp nhs [detail]','show ip nhrp shortcut'],
  interface:['tunnel source <interface-or-address...>','no tunnel source','tunnel destination <address>','no tunnel destination',
    'tunnel mode gre ip','tunnel mode gre multipoint','tunnel mode ipsec ipv4','tunnel protection ipsec profile <name>',
    'no tunnel protection ipsec profile [<name>]','tunnel key <number>','no tunnel key','keepalive <seconds> <retries>','no keepalive',
    'ip nhrp network-id <id>','no ip nhrp network-id','ip nhrp authentication <key>','no ip nhrp authentication',
    'ip nhrp map <protocol-address> <nbma-address>','no ip nhrp map <protocol-address> [<nbma-address>]',
    'ip nhrp map multicast dynamic','ip nhrp map multicast <nbma-address>','no ip nhrp map multicast [<nbma-address>]',
    'ip nhrp nhs <address>','no ip nhrp nhs <address>','ip nhrp redirect','no ip nhrp redirect','ip nhrp shortcut','no ip nhrp shortcut',
    'ip mtu <bytes>','no ip mtu','ip tcp adjust-mss <bytes>','no ip tcp adjust-mss']
};
const isTunnel=name=>name?.startsWith('Tu');

function localSource(lab,d,p) {
  const configured=p.gre?.source;
  if(!configured)return null;
  const found=Object.entries(d.ports).find(([name,port])=>!isTunnel(name)&&!port.vrf&&port.address&&
    (name===configured||port.address===configured)&&linkUp(lab,d,name));
  return found?.[1].address??null;
}

const multi=p=>p?.gre?.mode==='gre multipoint';
const mode=p=>p.gre.mode??'gre ip';

function reachable(lab,d,p,source,remote,q,destination) {
  if(!source||!destination||source===destination||p.gre.key!==q.gre.key||mode(p)!==mode(q))return null;
  let sa;
  const transport={sourceAddress:source,wiredOnly:true,baseOnly:true,noTunnels:true};
  if(p.gre.protection||q.gre.protection||mode(p)==='ipsec ipv4'){
    sa=negotiateIpsec(d,p,source,remote,q,destination);
    if(!sa)return null;
    const negotiation=transaction(lab,d,destination,{...transport,packet:{protocol:'udp',sourcePort:500,destinationPort:500}});
    if(!negotiation.ok)return null;
  }
  const hit=transaction(lab,d,destination,{...transport,packet:{protocol:sa?'esp':'gre'}});
  return hit.ok&&hit.destination===remote?{path:hit.path,source,destination,sa}:null;
}

function isHubFor(hub,source,spoke) {
  return Boolean(hub.address&&spoke.address&&spoke.nhrp?.nhs===hub.address&&spoke.nhrp.maps?.[hub.address]===source);
}
function sameCloud(a,b) {
  return Boolean(multi(a)&&multi(b)&&a.nhrp?.network&&a.nhrp.network===b.nhrp?.network&&a.nhrp.authentication===b.nhrp?.authentication);
}

export function tunnelPeers(lab,d,name,{multicast=false,includeShortcuts=false}={}) {
  const p=d.ports[name];
  if(!p?.up||!p.gre?.source||p.vrf)return [];
  const source=localSource(lab,d,p);
  if(!source)return [];
  const rows=[];
  for(const device of lab.devices){
    if(device===d||device.type!=='router')continue;
    for(const [port,q] of Object.entries(device.ports)){
      if(!isTunnel(port)||!q.up||q.vrf||!q.gre?.source||mode(p)!==mode(q)||p.gre.key!==q.gre.key)continue;
      const destination=localSource(lab,device,q);
      let role='point-to-point';
      if(!multi(p)){
        if(p.gre.destination!==destination||q.gre.destination!==source)continue;
      }else{
        if(!sameCloud(p,q))continue;
        const spoke=isHubFor(q,destination,p),hub=isHubFor(p,source,q);
        const short=includeShortcuts&&(own(p.nhrp.shortcuts,q.address)||own(q.nhrp.shortcuts,p.address));
        if(!spoke&&!hub&&!short)continue;
        if(multicast&&!(spoke&&p.nhrp.multicast===destination||hub&&p.nhrp.multicast==='dynamic'))continue;
        role=spoke?'NHS':hub?'registered':'shortcut';
      }
      const usable=reachable(lab,d,p,source,device,q,destination);
      if(usable)rows.push({device,port,role,...usable});
    }
  }
  return rows;
}

export const tunnelState=(lab,d,name)=>tunnelPeers(lab,d,name)[0]??null;

function branchReachable(d,port,destination,overlayNext) {
  if(d.ports[port].address===overlayNext)return true;
  return Object.entries(d.ports).some(([key,p])=>!isTunnel(key)&&p.up&&!p.vrf&&inSubnet(destination,p.address,p.prefix));
}

export function nhrpNext(lab,d,name,next,ip,learn=false) {
  const p=d.ports[name];
  if(!multi(p)||!p.nhrp?.nhs)return null;
  const hub=tunnelPeers(lab,d,name).find(row=>row.role==='NHS');
  if(!hub)return null;
  const peers=tunnelPeers(lab,hub.device,hub.port).filter(row=>row.role==='registered'&&row.device!==d);
  const candidate=peers.find(row=>branchReachable(row.device,row.port,ip,next));
  if(!candidate)return null;
  const q=candidate.device.ports[candidate.port],h=hub.device.ports[hub.port];
  if(h.nhrp.redirect&&p.nhrp.shortcut&&q.nhrp?.shortcut){
    const direct=reachable(lab,d,p,hub.source,candidate.device,q,candidate.destination);
    if(direct){
      if(own(p.nhrp.shortcuts,q.address))return {...candidate,...direct,role:'shortcut'};
      if(learn){(p.nhrp.shortcuts??={})[q.address]={destination:ip,peer:candidate.destination,hub:hub.device.id};}
    }
  }
  return hub;
}

export function recordTunnel(d,port,neighbor,count) {
  if(!neighbor.sa||!d.ports[port]?.gre||!neighbor.device.ports[neighbor.port]?.gre)return;
  const local=d.ports[port].gre,remote=neighbor.device.ports[neighbor.port].gre;
  const outbound=(local.counters??={})[neighbor.destination]??={};
  const inbound=(remote.counters??={})[neighbor.source]??={};
  outbound.encap=(outbound.encap??0)+count;
  inbound.decap=(inbound.decap??0)+count;
}

function nhrpPort(p,args) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [, ,field,value,nbma]=w;
  const nhrp=p.nhrp??={maps:{}};
  if(field==='network-id'){
    if(no)delete nhrp.network;
    else if(integer(value,1,4294967295))nhrp.network=Number(value);else return invalid('Use a valid NHRP network ID.');
    return reply();
  }
  if(field==='authentication'){
    if(no)delete nhrp.authentication;else nhrp.authentication=value;
    return reply();
  }
  if(field==='redirect'||field==='shortcut'){
    nhrp[field]=!no;
    if(no&&field==='shortcut')delete nhrp.shortcuts;
    return reply();
  }
  if(field==='nhs'&&ipv4(value)!==null){
    nhrp.nhs=no?undefined:value;delete nhrp.shortcuts;return reply();
  }
  if(field==='map'&&value==='multicast'){
    if(no)delete nhrp.multicast;
    else if(nbma==='dynamic'||ipv4(nbma)!==null)nhrp.multicast=nbma;else return invalid('Use a multicast NBMA address or dynamic.');
    return reply();
  }
  if(field==='map'&&ipv4(value)!==null){
    if(no)delete nhrp.maps[value];else if(ipv4(nbma)!==null)nhrp.maps[value]=nbma;else return invalid('Enter the NBMA address.');
    return reply();
  }
  return invalid('Check the NHRP arguments.');
}

export function grePort(d,name,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args,p=d.ports[name];
  if(w[0]==='ip'&&(w[1]==='mtu'||w[1]==='tcp'&&w[2]==='adjust-mss')){
    const mtu=w[1]==='mtu',key=mtu?'mtu':'mss',raw=w.at(-1);
    if(no)delete p[key];
    else if(integer(raw,mtu?68:64,mtu?9216:8960))p[key]=Number(raw);else return invalid('Check the IPv4 MTU or TCP MSS.');
    return reply();
  }
  if(!/^(?:no )?(?:tunnel |keepalive|ip nhrp )/.test(c))return null;
  if(d.type!=='router'||!isTunnel(name))return invalid('Use a router tunnel interface.');
  const gre=p.gre??={};
  if(w[1]==='nhrp')return nhrpPort(p,args);
  if(w[1]==='protection'){
    if(no)delete gre.protection;
    else if(keyName(w[4])&&own(d.ipsec?.protections,w[4]))gre.protection=w[4];else return invalid('Create the named tunnel IPsec profile first.');
    return reply();
  }
  if(w[0]==='keepalive'){
    if(no)delete gre.keepalive;
    else if(integer(w[1],1,32767)&&integer(w[2],1,255))gre.keepalive=[Number(w[1]),Number(w[2])];
    else return invalid('Check the GRE keepalive interval and retry count.');
    return reply();
  }
  const [,option,value]=w;
  if(no){delete gre[option];return reply();}
  if(option==='mode'){gre.mode=w.slice(2).join(' ');return reply();}
  if(option==='destination'&&ipv4(value)!==null){gre.destination=value;return reply();}
  if(option==='key'&&integer(value,0,4294967295)){gre.key=Number(value);return reply();}
  if(option==='source'){
    const port=interfaceName(w.slice(2));
    if(ipv4(value)!==null||d.ports[port]&&!isTunnel(port)){gre.source=d.ports[port]?port:value;return reply();}
  }
  return invalid('Check the GRE IPv4 endpoint or tunnel key.');
}

export function greShow(lab,d,args,c) {
  if(c.startsWith('show dmvpn')||c.startsWith('show ip nhrp')){
    const cloud=Object.entries(d.ports).filter(([,p])=>multi(p));
    return reply(cloud.flatMap(([name,p])=>{
      const peers=tunnelPeers(lab,d,name,{includeShortcuts:true});
      if(c.includes(' nhs'))return [name+'  NHS '+(p.nhrp?.nhs??'local hub')+'  '+(peers.some(row=>row.role==='NHS')?'UP':'—')];
      if(c.includes(' shortcut'))return peers.filter(row=>row.role==='shortcut').map(row=>row.device.ports[row.port].address+' via '+row.destination+'  '+name);
      return [name+'  '+(p.nhrp?.nhs?'Spoke':'Hub')+'  Total NBMA Peers: '+peers.length,
        ...peers.map(row=>row.device.ports[row.port].address+'  '+row.destination+'  UP  '+row.role+(row.sa?'  IPsec':''))];
    }).join('\n')||'No active NHRP mappings.');
  }
  if(!c.startsWith('show tunnel interface '))return null;
  const name=interfaceName(args.slice(3));
  const p=d.ports[name];
  if(!p||!isTunnel(name))return invalid('Select an existing tunnel interface.');
  const state=tunnelState(lab,d,name);
  return reply(name+' is '+(p.up?'up':'administratively down')+', line protocol is '+(state?'up':'down')+
    '\n  Tunnel source '+(state?.source??p.gre?.source??'unconfigured')+', destination '+(p.gre?.destination??'unconfigured')+
    '\n  Tunnel protocol/transport '+(p.gre?.mode==='ipsec ipv4'?'IPsec IPv4':multi(p)?'mGRE/IP':'GRE/IP')+(p.gre?.key!==undefined?' · Key '+p.gre.key:'')+
    (state?'\n  Underlay: '+state.path.map(id=>lab.devices.find(d=>d.id===id)?.name).join(' → '):'\n  Check underlay routing, matching endpoints and key.'),state?.path);
}

export function greRunning(p) {
  return [
    ...['source','destination','mode','key'].filter(name=>p.gre?.[name]!==undefined).map(name=>' tunnel '+name+' '+p.gre[name]),
    ...(p.gre?.keepalive?[' keepalive '+p.gre.keepalive.join(' ')]:[]),
    ...(p.gre?.protection?[' tunnel protection ipsec profile '+p.gre.protection]:[]),
    ...(p.mtu?[' ip mtu '+p.mtu]:[]),...(p.mss?[' ip tcp adjust-mss '+p.mss]:[]),
    ...(p.nhrp?.network?[' ip nhrp network-id '+p.nhrp.network]:[]),
    ...(p.nhrp?.authentication?[' ip nhrp authentication [configured]']:[]),
    ...(p.nhrp?.nhs?[' ip nhrp nhs '+p.nhrp.nhs]:[]),...(p.nhrp?.redirect?[' ip nhrp redirect']:[]),
    ...(p.nhrp?.shortcut?[' ip nhrp shortcut']:[]),
    ...Object.entries(p.nhrp?.maps??{}).map(([overlay,nbma])=>' ip nhrp map '+overlay+' '+nbma),
    ...(p.nhrp?.multicast?[' ip nhrp map multicast '+p.nhrp.multicast]:[])
  ];
}
