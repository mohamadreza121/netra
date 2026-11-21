import { deviceById, gateway, hostIp, inSubnet, ipv4, linkUp, macAddress, models, networkAddress, peer, prefixLength, routeTable } from './network.js';
import { areaId, ospfInterfaces, ospfNeighbors, ospfSnapshot, routerId } from './ospf.js';
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
  if (c==='show version') return reply(`Netra LabSim IOS-style console\nPlatform: ${models[d.type].title}\nHostname: ${d.name}\nEthernet ports: ${models[d.type].ports.length}`);
  if (c==='show clock') return reply(new Date().toLocaleTimeString());
  if (c==='show history') return reply((s.history??[]).join('\n'));
  if (/^show (cdp|lldp)(?: |$)/.test(c)) {
    const protocol=args[1];
    if (!args[2]) return reply(protocol.toUpperCase()+': '+((d.discovery?.[protocol]??(protocol==='cdp'))?'enabled':'disabled'));
    return rows('Device ID    Local Interface    Port ID',discover(lab,d,protocol).map(({port,node,remote})=>
      `${node.name.padEnd(13)}${port.padEnd(19)}${remote}${args[3]?'  '+models[node.type].title+'  '+(hostIp(node)??Object.values(node.ports).find(p=>p.address)?.address??'unassigned'):''}`),'No neighbors.');
  }
  if (c==='show arp'||c.startsWith('show arp ')||c==='show ip arp'||c.startsWith('show ip arp ')) {
    const address=args.at(-1);
    return rows('Address          Hardware Addr   Interface',Object.entries(d.arp??{}).filter(([ip,entry])=>
      (address==='arp'||ip===address)&&deviceById(lab,entry.device)&&linkUp(lab,d,entry.port)).map(([ip,e])=>`${ip.padEnd(17)}${e.mac.padEnd(16)}${e.port}`),'No ARP entries. Try ping first.');
  }
  if (c.startsWith('show mac address-table')) {
    const entries=Object.values(d.macTable??{}).filter(e=>linkUp(lab,d,e.port)&&Object.hasOwn(d.vlans,e.vlan));
    if (args[3]==='count') return reply('Dynamic addresses: '+entries.length);
    const filter=args[4], value=args[5];
    const displayed=args[3]==='static'||args[3]==='secure'?Object.entries(d.ports).flatMap(([port,p])=>[...(p.security?.static??[]),...(args[3]==='secure'?p.security?.learned??[]:[])].map(mac=>({mac,port,vlan:p.vlan,type:args[3].toUpperCase()}))):entries.filter(e=>!filter||(filter==='vlan'?e.vlan===Number(value):filter==='interface'?e.port===interfaceName([value]):e.mac===value.toLowerCase()));
    return rows('Vlan   Mac Address     Type      Ports',displayed.map(e=>`${String(e.vlan).padEnd(7)}${e.mac.padEnd(16)}${(e.type??'DYNAMIC').padEnd(10)}${e.port}`),'No MAC address entries.');
  }
  if (c.startsWith('show interfaces')||c==='show ip interface'||c.startsWith('show ip interface ')) {
    if (['show interfaces status','show interfaces trunk','show ip interface brief'].includes(c)) return null;
    const tail=args.slice(c.startsWith('show ip ')?3:2);
    const view=['description','switchport','status','trunk'].includes(tail.at(-1))?tail.pop():null;
    const name=tail.length?interfaceName(tail):null;
    if (tail.length&&!d.ports[name]) return invalid('This interface does not exist.');
    const entries=name?[[name,d.ports[name]]]:Object.entries(d.ports);
    return rows('',entries.map(([port,p])=>{
      const state=linkUp(lab,d,port)?'up':p.up?'down':'administratively down';
      if (view==='description') return [port,state,p.description??''].join('  ');
      if (view==='switchport'||view==='trunk') return `${port}  ${p.mode??'routed'}  Access VLAN: ${p.vlan??'—'}  Native VLAN: ${p.native??'—'}  Voice VLAN: ${p.voice??'—'}  Allowed: ${p.allowed?.join(',')??'all'}`;
      if (view==='status') return `${port}  ${state}  ${p.mode==='trunk'?'trunk':p.vlan??'routed'}`;
      return `${port} is ${state}, line protocol is ${linkUp(lab,d,port)?'up':'down'}\n  Description: ${p.description??'—'}\n  IPv4: ${p.address?p.address+'/'+p.prefix:'unassigned'}\n  Duplex: ${p.duplex??'auto'}  Speed: ${p.speed??'auto'}\n  Inbound ACL: ${p.acl?.in??'—'}  Outbound ACL: ${p.acl?.out??'—'}`;
    }));
  }
  if (c.startsWith('show ip route')) {
    const vrf=args[3]==='vrf'?args[4]:undefined;
    const query=args[vrf?5:3];
    const routes=routeTable(lab,d,vrf);
    const local=routes.filter(r=>r.protocol==='connected'&&r.prefix<32).map(r=>({...r,destination:d.ports[r.port].address,prefix:32,protocol:'local'}));
    const all=[...routes,...local].sort((a,b)=>b.prefix-a.prefix);
    const selected = !query?all:validIp(query)?all.filter(r=>inSubnet(query,r.destination,r.prefix)).slice(0,1):all.filter(r=>r.protocol===query);
    return rows('',selected.map(r=>{
      const code={connected:'C',local:'L',static:r.prefix?'S':'S*',ospf:'O'+(r.ospfType?' '+r.ospfType:''),bgp:'B',eigrp:r.external?'D EX':'D'}[r.protocol];
      return `${(code.length<3?code.padEnd(3):code+' ')}${r.destination}/${r.prefix} ${r.next?`[${r.distance}/${r.metric??0}] via ${r.next}, ${r.port}`:`is directly connected, ${r.port}`}`;
    }),'No active routes.');
  }
  if(c==='show ip protocols'){
    const body=[];
    if(d.ospf)body.push('Routing Protocol is "ospf '+d.ospf.id+'"',...d.ospf.networks.map(r=>
      '  Network '+r.address+' '+r.wildcard+' area '+(r.area??0)));
    if(d.eigrp?.asn)body.push('Routing Protocol is "eigrp '+d.eigrp.asn+'"',...d.eigrp.networks.map(r=>'  Network '+r.address+' '+r.wildcard));
    if(d.bgp)body.push('Routing Protocol is "bgp '+d.bgp.asn+'"',...Object.entries(d.bgp.neighbors).map(([ip,n])=>'  Neighbor '+ip+' AS '+n.asn));
    return reply(body.join('\n')||'No dynamic IPv4 routing protocols configured.');
  }
  if (c.startsWith('show ip ospf')) {
    if (!d.ospf) return reply('OSPF is not configured.');
    const header=`OSPF process ${d.ospf.id}, Router ID ${routerId(d)??'unassigned'}, Areas ${[...new Set(ospfInterfaces(lab,d).map(row=>row.area))].join(', ')||'none'}`;
    if (args[3]==='neighbor') return rows('Neighbor ID      State     Address          Interface',
      ospfNeighbors(lab,d,ospfSnapshot(lab)).map(n=>`${routerId(n.device).padEnd(17)}FULL      ${n.remote.address.padEnd(17)}${n.local.port}  area ${n.local.area}${args[4]?'   '+n.device.name:''}`),'No FULL adjacencies.');
    if (args[3]==='interface') {
      const name=args[4]&&args[4]!=='brief'?interfaceName(args.slice(4)):null;
      return rows('Interface   Address             Area  Cost  Hello/Dead',
        ospfInterfaces(lab,d).filter(p=>!name||p.port===name).map(p=>`${p.port.padEnd(12)}${(p.address+'/'+p.prefix).padEnd(20)}${String(p.area).padEnd(7)}${String(p.cost).padEnd(6)}${p.hello}/${p.dead} ${p.passive?'passive':p.network}`),'No active OSPF interfaces.');
    }
    if (args[3]==='database') return rows('OSPF reachable advertisements',routeTable(lab,d).filter(r=>r.protocol==='ospf').map(r=>r.destination+'/'+r.prefix+' via '+r.next+' metric '+r.metric));
    return reply(header+'\n'+d.ospf.networks.map(r=>' network '+r.address+' '+r.wildcard+' area '+(r.area??0)).join('\n'));
  }
  if (c.startsWith('show access-lists')||c.startsWith('show ip access-lists')) {
    const name=args.at(-1);
    return rows('',Object.entries(d.acl??{}).filter(([key])=>name==='access-lists'||key===name).flatMap(([key,list])=>
      [list.type+' IP access list '+key,...list.rules.map(rule=>'  '+rule.sequence+' '+rule.raw+(rule.hits?' ('+rule.hits+' matches)':''))]),'No access lists.');
  }
  if (c.startsWith('show ip dhcp pool')) {
    return rows('',Object.entries(d.pools).filter(([name])=>!args[4]||name===args[4].toUpperCase()).map(([name,p])=>
      `Pool ${name}  ${p.network??'unassigned'}/${p.prefix??'—'}  Router ${p.gateway??'—'}  DNS ${p.dns??'—'}  Leased: ${lab.devices.filter(client=>client.host.lease?.server===d.id&&inSubnet(client.host.lease.ip,p.network,p.prefix)).length}`),'No DHCP pools.');
  }
  if (c.startsWith('show ipv6 interface')) {
    const name=args[3]&&args[3]!=='brief'?interfaceName(args.slice(3)):null;
    if (args[3]&&args[3]!=='brief'&&!d.ports[name]) return invalid('This interface does not exist.');
    return rows('',Object.keys(d.ports).filter(port=>!name||port===name).map(port=>
      `${port} [${linkUp(lab,d,port)?'up/up':'down/down'}]\n  ${interfacesV6(d,port).map(a=>a.address+'/'+a.prefix).join('\n  ')||'unassigned'}`));
  }
  if (c.startsWith('show ipv6 route')) {
    const all=routesV6(lab,d);
    const locals=all.filter(r=>r.distance===0).map(r=>({...r,destination:r.address,prefix:128,local:true}));
    const filter=args[3];
    return rows('',[...all,...locals].filter(r=>!filter||(r.local?'local':r.distance===0?'connected':'static')===filter)
      .map(r=>`${r.local?'L':r.distance===0?'C':'S'}  ${r.destination}/${r.prefix} [${r.distance}/0] via ${r.next??'direct'}, ${r.port}`),'No IPv6 routes.');
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
    const [network, via, distanceText]=args.slice(no?3:2);
    const net=parsePrefixV6(network);
    const ip=parseV6(via);
    const targetPort=interfaceName([via]);
    const distance=Number(distanceText??1);
    if (!net||networkV6(net.address,net.prefix)!==net.address||(ip===null&&!d.ports[targetPort])||!integer(String(distance),1,254)) return invalid('Use ipv6 route PREFIX/LENGTH NEXT-HOP [DISTANCE].');
    const next=ip===null?undefined:formatV6(ip);
    const routePort=ip===null?targetPort:undefined;
    d.ipv6Routes=(d.ipv6Routes??[]).filter(r=>!(r.destination===net.address&&r.prefix===net.prefix&&r.next===next&&r.port===routePort));
    if (!no) d.ipv6Routes.push({destination:net.address,prefix:net.prefix,next,port:routePort,distance});
    return reply();
  }
  return null;
}
