import { deviceById, hostIp, ipv4, linkUp, macAddress, models, networkAddress, peer, prefixLength } from './network.js';
import { vlanDatabase } from './campus.js';
import { interfacesShow } from './interface-show.js';
import { showDhcp } from './dhcp-show.js';
import { showIPv4Routes, showIPProtocols, showOSPF } from './routing-show.js';
import { areaId } from './ospf.js';
import { parseRule } from './acl.js';
import { interfacesV6, neighborRowsV6, networkV6, parsePrefixV6, parseV6, routesV6, formatV6 } from './ipv6.js';

export const reply = (text='',path=[])=>({text,path});
export const invalid = message=>reply('% '+message);
export const integer = (raw,min,max)=>/^\d+$/.test(raw??'')&&Number(raw)>=min&&Number(raw)<=max;
export const validIp = address=>ipv4(address)!==null;
export const validName = name=>/^[\w-]{1,32}$/.test(name??'');
export const validVlan = id=>integer(id,1,4094);

export function interfaceName(words) {
  const name=words.join('').toLowerCase();
  const port=/^([a-z]+)(\d+\/\d+(?:\.[1-9]\d{0,3})?)$/.exec(name);
  if (port && 'gigabitethernet'.startsWith(port[1])) return 'Gi'+port[2];
  const channel=/^po(?:rt-channel)?(\d{1,2})$/.exec(name);
  if(channel)return 'Po'+Number(channel[1]);
  const virtual=/^(lo(?:opback)?|vl(?:an)?|tu(?:nnel)?)(\d{1,4})$/.exec(name);
  if (virtual) return (virtual[1].startsWith('lo')?'Lo':virtual[1].startsWith('tu')?'Tu':'Vlan')+Number(virtual[2]);
  return null;
}

export function portList(device, raw) {
  const ports=[];
  for (const term of raw.split(',')) {
    const [first,last,...extra]=term.trim().split(/\s*-\s*/);
    const name=interfaceName([first]);
    if (!name || !models[device.type].ports.includes(name) || extra.length) return null;
    if (!last) {ports.push(name);continue;}
    const end=last.includes('/')?interfaceName([last])??'Gi'+last:name.split('/')[0]+'/'+last;
    const list=models[device.type].ports;
    const beginIndex=list.indexOf(name), endIndex=list.indexOf(end);
    if (endIndex<beginIndex) return null;
    ports.push(...list.slice(beginIndex,endIndex+1));
  }
  return [...new Set(ports)];
}

export function vlanIds(raw) {
  if (!raw) return null;
  const ids=new Set();
  for (const part of raw.split(',')) {
    const [first,last=first,...extra]=part.split('-');
    if (extra.length||!validVlan(first)||!validVlan(last)||Number(last)<Number(first)) return null;
    for (let i=Number(first);i<=Number(last);i++) ids.add(i);
  }
  return [...ids].sort((a,b)=>a-b);
}

function discover(lab,device,protocol) {
  if (!(device.discovery?.[protocol]??(protocol==='cdp'))) return [];
  const localKeys=protocol==='cdp'?['cdp']:['lldpRx'];
  const remoteKeys=protocol==='cdp'?['cdp']:['lldpTx'];
  return models[device.type].ports.flatMap(port=>{
    const far=peer(lab,device,port);
    const node=far&&deviceById(lab,far.device);
    if (!node || !['router','switch','ap','wlc','phone'].includes(node.type) || !linkUp(lab,device,port)) return [];
    if (!(node.discovery?.[protocol]??(protocol==='cdp')) || device.ports[port][localKeys[0]]===false || node.ports[far.port][remoteKeys[0]]===false) return [];
    return [{port,node,remote:far.port}];
  });
}

const rows = (header, entries, empty='No entries.')=>reply(entries.length?[header,...entries].filter(Boolean).join('\n'):empty);

export function diagnostic(lab,d,s,args,c) {
  if(c==='show version')return reply([
    'Netra LabSim IOS-style console', 'Platform: '+models[d.type].platform, 'Hostname: '+d.name,
    'System image file is "LabSim built-in device model"',
    ...(d.bootInfo?.image?['Configured boot image: '+d.bootInfo.image]:[]),
    'Base Ethernet MAC Address: '+macAddress(d),'Ethernet ports: '+models[d.type].ports.length,
    'Configuration register is '+(d.bootInfo?.register??'0x2102')
  ].join('\n'));
  if (c==='show history') return reply((s.history??[]).join('\n'));
  if (/^show (cdp|lldp)(?: |$)/.test(c)) {
    const protocol=args[1],enabled=d.discovery?.[protocol]??(protocol==='cdp');
    if(!args[2])return reply(protocol.toUpperCase()+': '+(enabled?'enabled':'disabled'));
    const neighbors=discover(lab,d,protocol);
    const capability={router:'R',switch:'S I',phone:'H P',ap:'W',wlc:'W'};
    if(args[3]==='detail')return rows('',neighbors.map(({port,node,remote})=>[
      'Device ID: '+node.name,
      'Entry address(es): '+(hostIp(node)??Object.entries(node.ports).find(([name,p])=>p.address&&linkUp(lab,node,name))?.[1].address??'unassigned'),
      'Platform: '+models[node.type].platform+', Capabilities: '+capability[node.type],
      'Interface: '+port+', Port ID (outgoing port): '+remote
    ].join('\n')+'\n'),'No neighbors.');
    return rows('Device ID        Local Intrfce    Capability  Platform          Port ID',neighbors.map(({port,node,remote})=>
      node.name.padEnd(17)+port.padEnd(17)+capability[node.type].padEnd(12)+models[node.type].title.padEnd(18)+remote),'No neighbors.');
  }
  if (c==='show arp'||c.startsWith('show arp ')||c==='show ip arp'||c.startsWith('show ip arp ')) {
    const address=args.at(-1);
    return rows('Protocol  Address          Age (min)  Hardware Addr   Type   Interface',Object.entries(d.arp??{}).filter(([ip,entry])=>
      (address==='arp'||ip===address)&&deviceById(lab,entry.device)&&linkUp(lab,d,entry.port)).map(([ip,e])=>
      'Internet  '+ip.padEnd(17)+'-'.padEnd(11)+e.mac.padEnd(16)+'ARPA   '+e.port),'No ARP entries. Try ping first.');
  }
  if (c.startsWith('show mac address-table')) {
    const entries=Object.values(d.macTable??{}).filter(e=>linkUp(lab,d,e.port)&&Object.hasOwn(vlanDatabase(lab,d).vlans,e.vlan));
    if (args[3]==='count') return reply('Dynamic addresses: '+entries.length);
    const filter=args[4], value=args[5];
    const displayed=args[3]==='static'||args[3]==='secure'?Object.entries(d.ports).flatMap(([port,p])=>[...(p.security?.static??[]),...(args[3]==='secure'?p.security?.learned??[]:[])].map(mac=>({mac,port,vlan:p.vlan,type:args[3].toUpperCase()}))):entries.filter(e=>!filter||(filter==='vlan'?e.vlan===Number(value):filter==='interface'?e.port===interfaceName([value]):e.mac===value.toLowerCase()));
    return rows('Vlan   Mac Address     Type      Ports',displayed.map(e=>`${String(e.vlan).padEnd(7)}${e.mac.padEnd(16)}${(e.type??'DYNAMIC').padEnd(10)}${e.port}`),'No MAC address entries.');
  }
  if(c.startsWith('show interfaces')||args[1]==='ip'&&args[2]==='interface')return interfacesShow(lab,d,args);
  if(args[1]==='ip'&&args[2]==='route')return showIPv4Routes(lab,d,args);
  if(c==='show ip protocols')return showIPProtocols(lab,d);
  if(args[1]==='ip'&&args[2]==='ospf')return showOSPF(lab,d,args);
  if (c.startsWith('show access-lists')||c.startsWith('show ip access-lists')) {
    const name=args.at(-1);
    return rows('',Object.entries(d.acl??{}).filter(([key])=>name==='access-lists'||key===name).flatMap(([key,list])=>
      [list.type+' IP access list '+key,...list.rules.map(rule=>'  '+rule.sequence+' '+rule.raw+(rule.hits?' ('+rule.hits+' matches)':''))]),'No access lists.');
  }
  if(args[1]==='ip'&&args[2]==='dhcp'&&['binding','pool'].includes(args[3]))return showDhcp(lab,d,args);
  if (c.startsWith('show ipv6 interface')) {
    const name=args[3]&&args[3]!=='brief'?interfaceName(args.slice(3)):null;
    if (args[3]&&args[3]!=='brief'&&!d.ports[name]) return invalid('This interface does not exist.');
    return rows('',Object.keys(d.ports).filter(port=>!name||port===name).map(port=>
      `${port} [${linkUp(lab,d,port)?'up/up':'down/down'}]\n  ${interfacesV6(d,port).map(a=>a.address+'/'+a.prefix).join('\n  ')||'unassigned'}`));
  }
  if (c.startsWith('show ipv6 route')) {
    const vrf=args[3]==='vrf'?args[4]:undefined;
    const all=routesV6(lab,d,vrf),filter=vrf?args[5]:args[3];
    const locals=all.filter(r=>r.protocol==='connected').map(r=>({...r,destination:r.address,prefix:128,protocol:'local'}));
    return rows('',[...all,...locals].filter(r=>!filter||r.protocol===filter||r.destination+'/'+r.prefix===filter)
      .map(r=>`${{connected:'C',local:'L',static:'S',ospf:'O'+(r.ospfType?' '+r.ospfType:''),bgp:'B',eigrp:'D'}[r.protocol]}  ${r.destination}/${r.prefix} [${r.distance}/${r.metric??0}] via ${r.next??'direct'}, ${r.port}`),'No IPv6 routes.');
  }
  if (c==='show ipv6 neighbors') return rows('IPv6 Address   State   Interface',neighborRowsV6(lab,d));
  return null;
}

export function ospfConfig(d,s,args,c) {
  const p=d.ospf;
  if(!p)return invalid('This OSPF process no longer exists.');
  if (c.startsWith('router-id ')&&validIp(args[1])) {p.routerId=args[1];return reply();}
  if (c.startsWith('network ')||c.startsWith('no network ')) {
    const remove=args[0]==='no';
    const [address,wildcard,,area]=args.slice(remove?2:1);
    const id=areaId(area);
    if(!validIp(address)||!validIp(wildcard)||id===null)return invalid('Use an IPv4 wildcard and OSPF area number.');
    p.networks=p.networks.filter(rule=>rule.address!==address||rule.wildcard!==wildcard||(remove&&(rule.area??0)!==id));
    if(!remove)p.networks.push({address,wildcard,area:id});
    return reply();
  }
  if (c.includes('passive-interface')) {
    const no=args[0]==='no';
    const words=args.slice(no?2:1);
    if (words[0]==='default') {p.passiveDefault=!no; p.passive={};return reply();}
    const port=interfaceName(words);
    if (d.ports[port]) {p.passive[port]=!no;return reply();}
  }
  if (c.startsWith('auto-cost ')&&integer(args[2],1,4294967)) {p.reference=Number(args[2]);return reply();}
  if (c.startsWith('default-information originate')) {p.defaultRoute=args[2]==='always'?'always':true;return reply();}
  if (c==='no default-information originate') {delete p.defaultRoute;return reply();}
  if (c.startsWith('maximum-paths ')&&integer(args[1],1,16)) {p.maximumPaths=Number(args[1]);return reply();}
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(w[0]==='area'){
    const id=areaId(w[1]);
    if(id===null)return invalid('Use a valid OSPF area ID.');
    const area=(p.areas??={})[id]??={};
    if(w[2]==='stub'){
      if(!id)return invalid('The backbone cannot be a stub area.');
      if(no&&w[3]!=='no-summary')delete area.stub;else if(!no)area.stub=true;
      area.noSummary=!no&&w[3]==='no-summary';return reply();
    }
    if(w[2]==='authentication'){
      if(no)delete area.authentication;else area.authentication='message-digest';return reply();
    }
    if(w[2]==='range'){
      const [ip,mask,option,cost]=w.slice(3);
      const prefix=prefixLength(mask);
      if(!validIp(ip)||prefix===null||networkAddress(ip,prefix)!==ip||cost&&!integer(cost,1,16777215))return invalid('Enter a matching summary address and mask.');
      area.ranges=(area.ranges??[]).filter(row=>row.address!==ip||row.prefix!==prefix);
      if(!no)area.ranges.push({address:ip,prefix,noAdvertise:option==='not-advertise',cost:cost?Number(cost):undefined});
      return reply();
    }
  }
  if(w[0]==='redistribute'){
    const protocol=w[1],process=protocol==='eigrp'?Number(w[2]):undefined;
    const option=key=>{const i=w.indexOf(key);return i<0?undefined:w[i+1];};
    const metric=option('metric'),type=option('metric-type'),tag=option('tag'),map=option('route-map');
    if(process!==undefined&&!integer(w[2],1,65535)||metric&&!integer(metric,1,16777214)||type&&!['1','2'].includes(type)||
      tag&&!integer(tag,0,4294967295)||map&&!validName(map))return invalid('Check the OSPF redistribution options.');
    p.redistribute??={};
    if(no)delete p.redistribute[protocol];
    else p.redistribute[protocol]={process,metric:metric?Number(metric):undefined,type:type?Number(type):undefined,
      tag:tag?Number(tag):undefined,map,subnets:w.includes('subnets')};
    return reply();
  }
  return invalid('Check the OSPF arguments.');
}

export function ospfPort(d,port,args,c) {
  if(!c.startsWith('ip ospf ')&&!c.startsWith('no ip ospf ')&&!c.startsWith('bandwidth ')) return null;
  const p=d.ports[port];
  const set=(key,value)=>{p.ospf??={};p.ospf[key]=value;return reply();};
  if (args[0]==='bandwidth'&&integer(args[1],1,100000000)) {p.bandwidth=Number(args[1]);return reply();}
  if (args[2]==='network') return set('network',args[3]);
  if(c==='no ip ospf authentication'){if(p.ospf)delete p.ospf.authentication;return reply();}
  if(c==='ip ospf authentication message-digest')return set('authentication','message-digest');
  if(c.startsWith('no ip ospf message-digest-key ')){if(p.ospf?.keys)delete p.ospf.keys[args[4]];return reply();}
  if(c.startsWith('ip ospf message-digest-key ')){
    if(!integer(args[3],1,255))return invalid('Use an OSPF key ID from 1 to 255.');
    p.ospf??={};p.ospf.keys??={};p.ospf.keys[args[3]]=args[5];return reply();
  }
  if(c.startsWith('no ip ospf ')&&args[4]==='area'){if(p.ospf){delete p.ospf.process;delete p.ospf.area;}return reply();}
  if(args[3]==='area'&&integer(args[2],1,65535)&&areaId(args[4])!==null){
    const id=Number(args[2]);
    if (d.ospf&&d.ospf.id!==id) return invalid('This lab models one OSPF process per router.');
    d.ospf??={id,networks:[],passive:{}};
    set('area',areaId(args[4]));
    return set('process',id);
  }
  const bounds={cost:['cost',1,65535],'hello-interval':['hello',1,65535],'dead-interval':['dead',1,65535],priority:['priority',0,255]};
  const limit=bounds[args[2]];
  if (limit&&integer(args[3],limit[1],limit[2])) return set(limit[0],Number(args[3]));
  return invalid('Check the interface OSPF arguments.');
}

export function configureAcl(d,name,type,ruleArgs) {
  const list=Object.hasOwn(d.acl??{},name)?d.acl[name]:{type,rules:[]};
  if (list.type!==type) return invalid('That access-list name already uses a different type.');
  const next=(list.rules.at(-1)?.sequence??0)+10;
  let sequence=next;
  if (/^\d+$/.test(ruleArgs[0]??'')) sequence=Number(ruleArgs.shift());
  const rule=parseRule(type,ruleArgs,sequence);
  if (!rule) return invalid('Invalid access-list entry.');
  if (list.rules.some(existing=>existing.sequence===sequence)) return invalid('ACL sequence already exists.');
  list.rules.push(rule);
  list.rules.sort((a,b)=>a.sequence-b.sequence);
  d.acl??=Object.create(null);
  Object.defineProperty(d.acl,name,{value:list,writable:true,enumerable:true,configurable:true});
  return reply();
}

export function configureV6(d, port, args, c) {
  const no=args[0]==='no';
  if (c.endsWith('ipv6 unicast-routing')) {d.ipv6Routing=!no;return reply();}
  if (c.endsWith('ipv6 enable')) {d.ports[port].ipv6Enabled=!no;return reply();}
  if (c.includes('ipv6 address ')) {
    const key=args[no?3:2];
    const linkLocal=args.at(-1)==='link-local';
    const addr=parsePrefixV6(linkLocal&&!key.includes('/')?key+'/64':key);
    if (!addr || linkLocal&&!/^fe[89ab]/.test(addr.address)) return invalid('Use IPv6-address/prefix-length or an FE80::/10 link-local address.');
    const p=d.ports[port];
    p.ipv6=(p.ipv6??[]).filter(entry=>entry.address!==addr.address&&(!linkLocal||!entry.linkLocal));
    if (!no) p.ipv6.push({...addr,linkLocal});
    return reply();
  }
  if (c.includes('ipv6 route ')) {
    const words=args.slice(no?3:2);
    const vrf=words[0]==='vrf'?words[1]:undefined;
    if(vrf&&!Object.hasOwn(d.vrfs??{},vrf))return invalid('This VRF does not exist.');
    const [network,via,extra,weight]=vrf?words.slice(2):words;
    const net=parsePrefixV6(network),targetPort=interfaceName([via]),routePort=d.ports[targetPort]?targetPort:undefined;
    const nextWord=routePort?extra&&parseV6(extra)!==null?extra:undefined:via;
    const ip=nextWord?parseV6(nextWord):null;
    const preference=routePort&&ip!==null?weight:extra;
    const distance=Number(preference??1);
    if(!net||networkV6(net.address,net.prefix)!==net.address||ip===null&&!routePort||routePort&&d.ports[routePort].vrf!==vrf||
      !integer(String(distance),1,254)||ip!==null&&/^fe[89ab]/.test(formatV6(ip))&&!routePort)return invalid('Use ipv6 route PREFIX/LENGTH [INTERFACE] NEXT-HOP [DISTANCE]. Link-local next hops require an interface.');
    const next=ip===null?undefined:formatV6(ip);
    d.ipv6Routes=(d.ipv6Routes??[]).filter(r=>r.vrf!==vrf||r.destination!==net.address||r.prefix!==net.prefix||r.next!==next||r.port!==routePort);
    if(!no)d.ipv6Routes.push({destination:net.address,prefix:net.prefix,next,port:routePort,distance,vrf});
    return reply();
  }
  return null;
}
