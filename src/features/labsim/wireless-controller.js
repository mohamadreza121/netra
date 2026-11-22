import { authenticate } from './identity.js';
import { hostIp, ipv4, linkUp, macAddress, primaryPort, transaction } from './network.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';
import { interfaceName } from './ios.js';

export const apControllerCommands=[
  'capwap ap controller ip address <address>','capwap ap primary-base <name> <address>',
  'no capwap ap controller ip address','show capwap client config','show capwap client rcb'
];
export const wirelessIOS={
  operational:['show wlan summary','show wlan id <id>','show ap summary','show ap tag summary','show wireless client summary',
    'show wireless client mac-address <address> detail','show wireless tag policy detailed <name>','show wireless profile policy detailed <name>'],
  global:['wireless management interface <interface...>','wlan <name> <id> <ssid>','no wlan <name>',
    'wireless profile policy <name>','no wireless profile policy <name>','wireless tag policy <name>','no wireless tag policy <name>','ap <mac>'],
  wlan:['shutdown','no shutdown','security wpa wpa2 [ciphers aes]','no security wpa wpa2 [ciphers aes]',
    'security wpa akm psk','no security wpa akm psk','security wpa akm dot1x','no security wpa akm dot1x',
    'security wpa psk set-key ascii 0 <key>','security dot1x authentication-list <name>','no security wpa'],
  policy:['shutdown','no shutdown','vlan <id>','central switching','no central switching','aaa-override','no aaa-override'],
  tag:['wlan <name> policy <name>','no wlan <name>'],
  apConfig:['policy-tag <name>','no policy-tag'],
  interface:['switchport mode trunk','switchport trunk native vlan <id>']
};

const controller=d=>d.wireless??={wlans:{},policies:{},tags:{},aps:{}};
const mac=value=>/^[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}$/.test(value?.toLowerCase()??'');
export const managementPort=d=>d.wireless?.management??primaryPort(d);
export const wlcTag=(d,vlan)=>vlan===undefined||vlan===d.ports[primaryPort(d)]?.native?null:vlan;

export function apController(lab,ap) {
  if(!ap.capwap?.address||!hostIp(ap)||!linkUp(lab,ap,primaryPort(ap)))return null;
  const hit=transaction(lab,ap,ap.capwap.address,{wiredOnly:true,packet:{protocol:'udp',sourcePort:5246,destinationPort:5246}});
  return hit.ok&&hit.destination.type==='wlc'?hit.destination:null;
}

export function profiles(lab,ap) {
  if(!ap.radio.enabled)return [];
  if(!ap.capwap?.address)return [{
    ap,bridge:ap,ssid:ap.radio.ssid,key:ap.radio.key,security:ap.radio.key?'psk':'open',vlan:ap.radio.vlan,
    broadcast:ap.radio.broadcast!==false
  }];
  const wlc=apController(lab,ap);
  if(!wlc?.wireless)return [];
  const config=wlc.wireless;
  const tag=own(config.aps,macAddress(ap))??'default-policy-tag';
  return Object.entries(own(config.tags,tag)??{}).flatMap(([name,policyName])=>{
    const wlan=own(config.wlans,name), policy=own(config.policies,policyName);
    if(!wlan?.up||!policy?.up)return [];
    if(wlan.security!=='open'&&(wlan.wpa2===false||wlan.aes===false||wlan.security==='psk'&&!wlan.key))return [];
    return [{...wlan,ap,wlc,policy,bridge:policy.central!==false?wlc:ap,vlan:policy.vlan,broadcast:true}];
  });
}

export function wifiSession(lab,client) {
  const saved=client.host.wifi;
  if(!saved)return null;
  const ap=lab.devices.find(d=>d.id===saved.ap&&d.type==='ap');
  if(!ap)return null;
  const active=profiles(lab,ap).find(p=>p.ssid===saved.ssid&&(p.wlc?.id??null)===(saved.controller??null)
    &&(p.security==='dot1x'?saved.security==='dot1x':(p.key??'')===saved.key));
  return active?{...active,vlan:(active.policy?.override&&saved.assignedVlan)||active.vlan}:null;
}

export function associate(lab,client,ssid,key='',password,enterprise=false) {
  const candidates=lab.devices.filter(d=>d.type==='ap').flatMap(ap=>profiles(lab,ap)).filter(profile=>profile.ssid===ssid);
  const active=candidates.find(p=>enterprise?p.security==='dot1x':p.security!=='dot1x'&&(p.key??'')===key);
  if(!active)return {ok:false,reason:'Check SSID, AP join state and security settings.'};
  const clients=lab.devices.filter(d=>d!==client&&d.host.wifi?.ap===active.ap.id&&wifiSession(lab,d));
  if(clients.length>=(active.ap.radio.maxClients??50))return {ok:false,reason:'The AP has reached its client limit.'};
  const verdict=enterprise?authenticate(lab,active.wlc,'dot1x',own(active.wlc.aaa?.dot1xLists,active.authList??'default')??active.wlc.aaa?.dot1xGroup??'radius',key,password):null;
  if(verdict&&verdict.status!=='accept')return {ok:false,reason:verdict.reason,path:verdict.path};
  client.host.wifi={ap:active.ap.id,ssid,key:enterprise?undefined:key,controller:active.wlc?.id,security:active.security,assignedVlan:verdict?.vlan};
  delete client.host.lease;
  return {ok:true,path:verdict?.path};
}

export function apControllerCLI(lab,ap,args,c) {
  if(c.startsWith('capwap ap ')){
    const address=args.at(-1);
    if(ipv4(address)===null)return invalid('Enter the controller management IPv4 address.');
    ap.capwap={address,primary:args[2]==='primary-base'?args[3]:null};return reply();
  }
  if(c==='no capwap ap controller ip address'){delete ap.capwap;return reply('Returned to standalone mode.');}
  if(c==='show capwap client config')return reply('Controller IPv4: '+(ap.capwap?.address??'unconfigured')+'\nPrimary: '+(ap.capwap?.primary??'—'));
  if(c==='show capwap client rcb'){
    if(!ap.capwap)return reply('Standalone · no CAPWAP controller configured.');
    const wlc=apController(lab,ap);
    return reply(wlc?'RUN · '+wlc.name+' · '+ap.capwap.address:'DISCOVERY · controller management unreachable.');
  }
  return null;
}

const wlanRow=(name,x)=>name+'  '+x.id+'  '+x.ssid+'  '+(x.up?'UP':'DOWN')+'  '+x.security.toUpperCase();
const policyRow=(name,x)=>name+'  VLAN '+(x.vlan??'native')+'  '+(x.up?'UP':'DOWN')+'  '+(x.central!==false?'central':'local')+(x.override?' · AAA override':'');
const clientRow=({host,network})=>macAddress(host)+'  '+network.ap.name+'  '+network.ssid+'  VLAN '+(network.vlan??'native')+'  '+(hostIp(host)??'unassigned');

export function wlcCLI(lab,d,s,args,c) {
  if(d.type!=='wlc')return null;
  const [verb,sub,name,kind,value]=args;
  const data=d.wireless;
  if(c==='show wlan summary'||c.startsWith('show wlan id ')){
    const rows=Object.entries(data?.wlans??{}).filter(([,x])=>name!=='id'||x.id===Number(kind)).map(([key,row])=>wlanRow(key,row));
    return reply(rows.length?['Profile  ID  SSID  Status  Security',...rows].join('\n'):'No WLANs configured.');
  }
  if(c==='show ap summary'||c==='show ap tag summary'){
    const summary=c==='show ap summary';
    const rows=lab.devices.filter(ap=>ap.type==='ap'&&apController(lab,ap)===d)
      .map(ap=>ap.name+'  '+macAddress(ap)+(summary?'  '+hostIp(ap)+'  RUN':'')+'  '+(own(data?.aps,macAddress(ap))??'default-policy-tag'));
    return reply(rows.length?[summary?'AP  Ethernet MAC  IPv4  CAPWAP  Policy tag':'AP  Ethernet MAC  Policy tag',...rows].join('\n'):'No joined access points.');
  }
  if(c.startsWith('show wireless client ')){
    const rows=lab.devices.flatMap(host=>{
      const network=wifiSession(lab,host);
      return network?.wlc===d&&(kind==='summary'||macAddress(host)===value?.toLowerCase())?[{host,network}]:[];
    }).map(clientRow);
    return reply(rows.length?['MAC  AP  SSID  VLAN  IPv4',...rows].join('\n'):'No associated clients.');
  }
  if(c.startsWith('show wireless tag policy detailed ')){
    const entry=own(data?.tags,args[5]);
    return reply(entry?Object.entries(entry).map(([w,p])=>w+' → '+p).join('\n')||'No WLAN mappings.':'Policy tag not found.');
  }
  if(c.startsWith('show wireless profile policy detailed ')){
    const entry=own(data?.policies,args[5]);
    return reply(entry?policyRow(args[5],entry):'Policy profile not found.');
  }
  if(s.mode==='interface'&&c.startsWith('switchport ')){
    const p=d.ports[s.current];
    if(s.current!==primaryPort(d))return invalid('Use the physical uplink for trunk configuration.');
    if(c==='switchport mode trunk'){p.mode='trunk';return reply();}
    if(!integer(value,1,4094))return invalid('Use a VLAN from 1 to 4094.');
    p.native=Number(value);return reply();
  }
  if(s.mode==='global') {
    if(c.startsWith('wireless management interface ')){
      const intf=interfaceName(args.slice(3));
      if(!d.ports[intf]||!intf.startsWith('Vlan'))return invalid('Create the management VLAN interface first.');
      controller(d).management=intf;return reply();
    }
    if(verb==='wlan'){
      if(!keyName(sub)||!integer(name,1,512)||!kind||kind.length>32)return invalid('Use a profile, WLAN ID 1–512 and SSID up to 32 characters.');
      const cfg=controller(d);
      if(Object.entries(cfg.wlans).some(([key,x])=>key!==sub&&x.id===Number(name)))return invalid('WLAN ID is already in use.');
      cfg.wlans[sub]={up:false,security:'dot1x',...own(cfg.wlans,sub),id:Number(name),ssid:kind};
      return enter(s,'wlan',sub);
    }
    if(c.startsWith('no wlan ')){if(data)delete data.wlans[name];return reply();}
    if((verb==='wireless'&&['profile','tag'].includes(sub))||(verb==='no'&&sub==='wireless'&&['profile','tag'].includes(name))){
      const remove=verb==='no', tag=(remove?name:sub)==='tag';
      const key=args.at(-1);
      if(!keyName(key))return invalid('Use a valid profile or tag name.');
      const collection=controller(d)[tag?'tags':'policies'];
      if(remove){delete collection[key];return reply();}
      collection[key]??=tag?{}:{up:false,central:true};
      return enter(s,tag?'tag':'policy',key);
    }
    if(verb==='ap')return mac(sub)?enter(s,'apConfig',sub.toLowerCase()):invalid('Use the AP Ethernet MAC shown by show ap summary.');
  }
  if(s.mode==='wlan'){
    const row=data.wlans[s.current];
    if(c==='no shutdown'||c==='shutdown'){
      if(c==='no shutdown'&&row.security==='psk'&&!row.key)return invalid('Set the WPA2 pre-shared key before enabling the WLAN.');
      row.up=c==='no shutdown';return reply();
    }
    if(c==='no security wpa'){row.security='open';return reply();}
    if(c==='security wpa wpa2'||c==='no security wpa wpa2'){row.wpa2=verb!=='no';return reply();}
    if(c.endsWith('security wpa wpa2 ciphers aes')){row.aes=verb!=='no';return reply();}
    if(c.startsWith('security wpa akm ')){row.security=kind;return reply();}
    if(c.startsWith('no security wpa akm ')){if(row.security===value)row.security='open';return reply();}
    if(c.startsWith('security wpa psk set-key ')){
      const key=args.at(-1);
      if(key.length<8||key.length>63)return invalid('Enter a key of 8–63 characters.');
      row.key=key;return reply();
    }
    if(c.startsWith('security dot1x authentication-list ')){row.authList=kind;return reply();}
  }
  if(s.mode==='policy'){
    const row=data.policies[s.current];
    if(c==='no shutdown'||c==='shutdown'){row.up=c==='no shutdown';return reply();}
    if(verb==='vlan'){
      if(!integer(sub,1,4094))return invalid('Use a VLAN from 1 to 4094.');
      row.vlan=Number(sub);return reply();
    }
    if(c.endsWith('central switching')){row.central=verb!=='no';return reply();}
    if(c.endsWith('aaa-override')){row.override=verb!=='no';return reply();}
  }
  if(s.mode==='tag'){
    const entry=data.tags[s.current];
    if(c.startsWith('no wlan ')){delete entry[name];return reply();}
    if(verb==='wlan'&&own(data.wlans,sub)&&own(data.policies,kind)){entry[sub]=kind;return reply();}
    return invalid('Configure the WLAN and policy profile first.');
  }
  if(s.mode==='apConfig'){
    if(c==='no policy-tag'){delete controller(d).aps[s.current];return reply();}
    if(own(data?.tags,sub)){data.aps[s.current]=sub;return reply();}
    return invalid('Configure the named policy tag first.');
  }
  return null;
}

export function wirelessRunning(d) {
  const cfg=d.wireless;
  if(!cfg)return [];
  return [
    ...(cfg.management?['wireless management interface '+cfg.management]:[]),
    ...Object.entries(cfg.wlans).flatMap(([name,row])=>['wlan '+name+' '+row.id+' '+row.ssid,
      row.security==='open'?' no security wpa':' security wpa akm '+row.security,
      ...(row.wpa2!==undefined?[' '+(row.wpa2?'':'no ')+'security wpa wpa2']:[]),
      ...(row.aes!==undefined?[' '+(row.aes?'':'no ')+'security wpa wpa2 ciphers aes']:[]),
      ...(row.key?[' security wpa psk set-key ascii 0 [configured]']:[]),
      ...(row.authList?[' security dot1x authentication-list '+row.authList]:[]),row.up?' no shutdown':' shutdown']),
    ...Object.entries(cfg.policies).flatMap(([name,row])=>['wireless profile policy '+name,
      ...(row.vlan?[' vlan '+row.vlan]:[]),row.central!==false?' central switching':' no central switching',
      ...(row.override?[' aaa-override']:[]),row.up?' no shutdown':' shutdown']),
    ...Object.entries(cfg.tags).flatMap(([name,tag])=>['wireless tag policy '+name,...Object.entries(tag).map(([w,p])=>' wlan '+w+' policy '+p)]),
    ...Object.entries(cfg.aps).flatMap(([address,tag])=>['ap '+address,' policy-tag '+tag])
  ];
}
