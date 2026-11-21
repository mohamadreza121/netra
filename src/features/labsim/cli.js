import { deviceById, gateway, hostIp, hostPrefix, ipv4, dotted, prefixLength, linkUp, models, networkAddress, ping, requestDhcp, routeTable, joinWifi, wifiUp, voiceVlan, isHost, mask } from './network.js';

import { assist, resolve, tokens } from './grammar.js';
import { commandSets, filterGrammar, grammars } from './commands.js';
import { accessPoint, apBand, apChannel } from './ap.js';
import { configureAcl, configureV6, diagnostic, integer, interfaceName, invalid, ospfConfig, ospfPort, portList, reply, validIp, validName, validVlan, vlanIds } from './ios.js';
import { parseV6, pingV6 } from './ipv6.js';
import { switchingConfig, switchingShow } from './switching.js';
import { natConfig, natRunning, natShow } from './nat.js';
import { layer2Config, layer2Running, layer2Show } from './layer2-security.js';

export { commandSets };

const showAddress = d=>hostIp(d)?`${hostIp(d)}/${hostPrefix(d)}`:'unassigned';

export const syntax = {
  ios:[
    ['Device modes','enable · configure terminal · interface gi0/0 · exit · end','From configuration mode use do show running-config. Enter ? to inspect the current mode.'],
    ['Display and save','show ip interface brief · show interfaces status · show running-config · show startup-config · copy running-config startup-config','Startup config is a readable snapshot. The browser saves the working topology separately.'],
  ],
  router:[
    ['IPv4 and static routing','ip address 192.0.2.1 255.255.255.0 · no shutdown · shutdown','Enter interface mode before configuring an address.'],
    ['Static routes','ip route 10.20.0.0 255.255.0.0 192.0.2.2 [distance] · no ip route … · show ip route','The next hop must be directly connected in this simulator. Use 0.0.0.0 0.0.0.0 for a default route.'],
    ['Router-on-a-stick','interface gi0/0.10 · encapsulation dot1Q 10','Bring up the parent port, then address each subinterface. Connect the parent to a switch trunk.'],
    ['Router DHCP','ip dhcp excluded-address 192.168.10.1 192.168.10.20 · ip dhcp pool STAFF · network 192.168.10.0 /24 · default-router 192.168.10.1 · show ip dhcp binding','Create a pool on the client VLAN. Clients request a lease with ipconfig /renew.'],
    ['Connectivity','ping 192.168.10.21 · traceroute 192.168.10.21','LabSim displays the simulated path and the first failure it can identify.']
  ],
  switch:[
    ['VLANs','vlan 10 · name STAFF · show vlan brief','Create the VLAN before testing forwarding on it.'],
    ['Access and voice ports','switchport mode access · switchport access vlan 10 · switchport voice vlan 20 · no switchport voice vlan','Each wired phone sends traffic on its directly attached switch port’s configured voice VLAN.'],
    ['802.1Q trunk','switchport mode trunk · switchport trunk native vlan 99 · switchport trunk allowed vlan 10,20,99 · switchport trunk allowed vlan add 20 · show interfaces trunk','Configure both trunk ends. An untagged frame maps to the receiving port’s native VLAN.'],
    ['Port operations','shutdown · no shutdown · description Workstation · show interfaces status','Disabling a port breaks the link and can interrupt both directions.']
  ],
  pc:[
    ['PC addressing','ipconfig · ipconfig /all · ipconfig /renew · ipconfig /release · ip address 192.168.10.31 24 192.168.10.1','The ip address command is a LabSim shortcut for host network settings.'],
    ['Host connectivity','ping 192.168.10.1 · tracert 192.168.10.1','Ping checks the forward and return paths.'],
    ['Wi-Fi client','wifi scan · wifi join Netra-Staff NetraLab26 · wifi status · wifi leave','These are LabSim client controls. Quote an SSID or key with spaces. A joined client uses Wi-Fi for its lab traffic.']
  ],
  phone:[
    ['Voice endpoint','extension 2001 · dial 2002 · show phone','These LabSim controls set an extension and test IP reachability to a second phone. Calls are modeled as signaling checks.'],
    ['Network and Wi-Fi','ipconfig /renew · ipconfig · wifi scan · wifi join Netra-Staff NetraLab26','Phones can use a wired voice VLAN or join an AP.']
  ],
  ap:[
    ['Access point radio','ssid Netra-Staff · security wpa2-psk NetraLab26 · radio on · radio off · show wireless','These LabSim controls define a PSK-protected SSID. Wire the AP to an access port on the client VLAN.']
  ]
};

export function terminalSession(d) {
  return {mode:['router','switch'].includes(d.type)?'user':'endpoint',current:null,history:[]};
}

function promptMode(session) {
  return { global:'config',interface:'config-if',vlan:'config-vlan',pool:'dhcp-config',ospf:'config-router',acl:'config-acl',range:'config-if-range' }[session.mode];
}
export function prompt(d,session) {
  const suffix=promptMode(session);
  return d.name+(suffix?`(${suffix})#`:session.mode==='exec'?'#':'>');
}

function pipeAt(input) {
  let offset=0;
  for (const {raw} of tokens(input)) {
    const at=input.indexOf(raw,offset);
    if(raw==='|')return at;
    offset=at+raw.length;
  }
  return -1;
}

export function commandHelp(device,session,partial='') {
  const pipe=pipeAt(partial);
  if(pipe<0)return assist(grammars[device.type][session.mode],partial);
  const lead=partial.slice(0,pipe+1);
  const help=assist(filterGrammar,partial.slice(pipe+1));
  if(help.completed)help.completed=lead+help.completed;
  return help;
}

function filtered(text, type, value) {
  const lines=text.split('\n');
  const match=line=>line.toLowerCase().includes(value.toLowerCase());
  if(type==='include'||type==='exclude')return lines.filter(line=>match(line)===(type==='include')).join('\n');
  if(type==='begin'){const index=lines.findIndex(match);return index<0?'':lines.slice(index).join('\n');}
  let section=false;
  return lines.filter(line=>{
    if(!line.startsWith(' '))section=match(line);
    return section;
  }).join('\n');
}

function running(d) {
  const rows=[`hostname ${d.name}`];
  for(const [id,name] of Object.entries(d.vlans))if(id!=='1')rows.push('vlan '+id,' name '+name,...(d.inactiveVlans?.includes(Number(id))?[' shutdown']:[]));
  if (gateway(d)) rows.push('ip default-gateway '+gateway(d));
  for (const [protocol, enabled] of Object.entries(d.discovery??{})) rows.push((enabled?'':'no ')+protocol+' run');
  if (d.stp?.mode) rows.push('spanning-tree mode '+d.stp.mode);
  if (d.stp?.portfast) rows.push('spanning-tree portfast default');
  if (d.stp?.guard) rows.push('spanning-tree portfast bpduguard default');
  for (const [vlan,value] of Object.entries(d.stp?.vlans??{})) rows.push('spanning-tree vlan '+vlan+' priority '+value.priority);
  rows.push(...layer2Running(d));
  if (d.ipv4Routing!==undefined) rows.push((d.ipv4Routing?'':'no ')+'ip routing');
  if (d.dhcpDisabled) rows.push('no service dhcp');
  if (d.ipv6Routing) rows.push('ipv6 unicast-routing');
  for(const [name,p] of Object.entries(d.ports)) {
    rows.push('interface '+name);
    if(p.description)rows.push(' description '+p.description);
    if(p.address)rows.push(` ip address ${p.address} ${dotted(mask(p.prefix))}`);
    if(p.tag)rows.push(' encapsulation dot1Q '+p.tag+(p.nativeEncapsulation?' native':''));
    if(p.nat)rows.push(' ip nat '+p.nat);
    if(p.helper)rows.push(' ip helper-address '+p.helper);
    if(p.speed)rows.push(' speed '+p.speed);
    if(p.duplex)rows.push(' duplex '+p.duplex);
    if(p.bandwidth)rows.push(' bandwidth '+p.bandwidth);
    if(p.ipv6Enabled)rows.push(' ipv6 enable');
    for (const a of p.ipv6??[]) rows.push(' ipv6 address '+a.address+(a.linkLocal?' link-local':'/'+a.prefix));
    if(p.ospf?.process) rows.push(' ip ospf '+p.ospf.process+' area 0');
    for (const [field,key] of [['cost','cost'],['hello','hello-interval'],['dead','dead-interval'],['priority','priority'],['network','network']]) {
      if(p.ospf?.[field]!==undefined)rows.push(' ip ospf '+key+' '+p.ospf[field]);
    }
    for (const [direction,name] of Object.entries(p.acl??{})) rows.push(' ip access-group '+name+' '+direction);
    if(d.type==='switch'&&p.mode==='routed')rows.push(' no switchport');
    if(d.type==='switch'&&!name.startsWith('Vlan')&&p.mode!=='routed') {
      if(p.dhcpTrust)rows.push(' ip dhcp snooping trust');
      if(p.arpTrust)rows.push(' ip arp inspection trust');
      if(p.nonegotiate)rows.push(' switchport nonegotiate');
      if(p.channel)rows.push(' channel-group '+p.channel.id+' mode '+p.channel.mode);
      if(p.portfast!==undefined)rows.push(' spanning-tree portfast'+(p.portfast?'':' disable'));
      if(p.bpduguard!==undefined)rows.push(' spanning-tree bpduguard '+(p.bpduguard?'enable':'disable'));
      for(const [vlan,values] of Object.entries(p.stp??{}))for(const [key,value] of Object.entries(values))rows.push(' spanning-tree '+(vlan==='all'?'':'vlan '+vlan+' ')+key+' '+value);
      if(p.security?.enabled){
        rows.push(' switchport port-security');
        if(p.security.maximum)rows.push(' switchport port-security maximum '+p.security.maximum);
        if(p.security.violation)rows.push(' switchport port-security violation '+p.security.violation);
        if(p.security.sticky)rows.push(' switchport port-security mac-address sticky');
        for(const address of [...(p.security.static??[]),...(p.security.sticky?p.security.learned??[]:[])])rows.push(' switchport port-security mac-address '+address);
      }
      rows.push(' switchport mode '+p.mode);
      if(p.mode==='trunk') {
        if(p.native!==1)rows.push(' switchport trunk native vlan '+p.native);
        if(p.allowed)rows.push(' switchport trunk allowed vlan '+p.allowed.join(','));
      } else {
        if(p.vlan!==1)rows.push(' switchport access vlan '+p.vlan);
        if(p.voice)rows.push(' switchport voice vlan '+p.voice);
      }
    }
    rows.push(p.up?' no shutdown':' shutdown');
  }
  for(const r of d.routes)rows.push(`ip route ${r.destination} ${dotted(mask(r.prefix))} ${r.next??r.port}${r.distance!==1?' '+r.distance:''}`);
  for(const [a,b] of d.excluded)rows.push('ip dhcp excluded-address '+a+' '+b);
  for(const [name,p] of Object.entries(d.pools)) {
    rows.push('ip dhcp pool '+name);
    if(p.network)rows.push(` network ${p.network} ${dotted(mask(p.prefix))}`);
    if(p.gateway)rows.push(' default-router '+p.gateway);
    if(p.dns)rows.push(' dns-server '+p.dns);
    if(p.domain)rows.push(' domain-name '+p.domain);
    if(p.lease)rows.push(' lease '+p.lease);
  }
  for (const [name,list] of Object.entries(d.acl??{})) {
    rows.push('ip access-list '+list.type+' '+name,...list.rules.map(rule=>' '+rule.sequence+' '+rule.raw));
  }
  for (const r of d.ipv6Routes??[]) rows.push('ipv6 route '+r.destination+'/'+r.prefix+' '+(r.next??r.port)+(r.distance!==1?' '+r.distance:''));
  if (d.ospf) {
    const p=d.ospf;
    rows.push('router ospf '+p.id);
    if(p.routerId)rows.push(' router-id '+p.routerId);
    if(p.reference)rows.push(' auto-cost reference-bandwidth '+p.reference);
    if(p.passiveDefault)rows.push(' passive-interface default');
    for(const [port,passive] of Object.entries(p.passive))rows.push(' '+(passive?'':'no ')+'passive-interface '+port);
    if(p.defaultRoute)rows.push(' default-information originate'+(p.defaultRoute==='always'?' always':''));
    if(p.maximumPaths)rows.push(' maximum-paths '+p.maximumPaths);
    for(const rule of p.networks)rows.push(' network '+rule.address+' '+rule.wildcard+' area 0');
  }
  rows.push(...natRunning(d));
  return rows.join('\n');
}

function connectivity(lab,d,command,ip) {
  const result=parseV6(ip)===null?ping(lab,d,ip):pingV6(lab,d,ip);
  const path=result.path.map(id=>deviceById(lab,id)?.name).join(' → ');
  if(!result.ok)return reply(`${command==='ping'?'.....\nSuccess rate is 0 percent (0/5)\n':''}${result.reason}\nPath: ${path}`,result.path);
  return reply((command==='ping'?'!!!!!\nSuccess rate is 100 percent (5/5)\n':'')+'Path: '+path,result.path);
}

function show(lab,d,s,args,c) {
  if(d.type==='switch'&&(c.startsWith('show ip dhcp snooping')||c.startsWith('show ip arp inspection')))return reply(layer2Show(lab,d,args));
  if(d.type==='switch'&&['spanning-tree','etherchannel','port-security'].includes(args[1]))return reply(switchingShow(lab,d,args));
  if(args[1]==='ip'&&args[2]==='nat')return reply(natShow(d,args[3]==='statistics'));
  const result=diagnostic(lab,d,s,args,c);
  if (result) return result;
  if(c==='show running-config')return reply(running(d));
  if(c.startsWith('show running-config interface ')){
    const name=interfaceName(args.slice(3));
    return d.ports[name]?reply(filtered(running(d),'section','interface '+name)):invalid('This interface does not exist.');
  }
  if(c==='show startup-config')return reply(d.startup??'startup-config is not present');
  if(c==='show ip interface brief')return reply(['Interface     IP-Address       Status                  Protocol',
    ...Object.entries(d.ports).map(([n,p])=>`${n.padEnd(13)} ${(p.address??'unassigned').padEnd(16)} ${(p.up?(linkUp(lab,d,n)?'up':'down'):'administratively down').padEnd(23)} ${linkUp(lab,d,n)?'up':'down'}`)].join('\n'));
  if(c==='show interfaces status')return reply(['Port          State         VLAN / mode',
    ...Object.entries(d.ports).map(([name,p])=>`${name.padEnd(13)} ${(linkUp(lab,d,name)?'connected':p.up?'notconnect':'disabled').padEnd(13)} ${d.type==='switch'?(p.mode==='trunk'?'trunk':p.vlan+(p.voice?' / voice '+p.voice:'')):'routed'}`)].join('\n'));
  if(args[1]==='vlan'&&d.type==='switch')return reply(['VLAN  Name              Status    Access ports',
    ...Object.entries(d.vlans).filter(([id,name])=>!args[3]||(args[2]==='id'?String(Number(args[3]))===id:args[3]===name)).map(([id,name])=>`${id.padEnd(5)} ${name.padEnd(17)} ${d.inactiveVlans?.includes(Number(id))?'suspend  ':'active   '} ${Object.entries(d.ports).filter(([,p])=>p.mode==='access'&&(p.vlan===Number(id)||p.voice===Number(id))).map(([key])=>key).join(', ')}`)].join('\n'));
  if(c==='show interfaces trunk'&&d.type==='switch')return reply(['Port     Status     Native  Allowed VLANs',
    ...Object.entries(d.ports).filter(([,p])=>p.mode==='trunk').map(([name,p])=>`${name.padEnd(8)} ${(linkUp(lab,d,name)?'trunking':'down').padEnd(10)} ${String(p.native).padEnd(7)} ${p.allowed?.join(',')??'all'}`)].join('\n'));
  if(c.startsWith('show ip dhcp binding')&&d.type==='router')return reply(lab.devices.filter(x=>x.host.lease?.server===d.id&&(!args[4]||args[4]===x.host.lease.ip)).map(x=>`${x.host.lease.ip}   ${x.name}   Automatic`).join('\n')||'No DHCP bindings.');
  return invalid('That show command is unavailable on this device.');
}

function runEndpoint(lab,d,args) {
  const [word,parameter,target,extra]=args;
  const cmd=word.toLowerCase();
  const action=cmd==='ssid'?parameter:parameter?.toLowerCase();
  if(d.type==='ap') return accessPoint(lab,d,args,connectivity);

  if(cmd==='ipconfig') {
    if(action==='/renew'){const result=requestDhcp(lab,d);return reply(result.ok?`DHCP lease: ${result.ip} from ${result.server}`:result.reason,result.path);}
    if(action==='/release'){delete d.host.lease;return reply('DHCP lease released.');}
    if(!action||action==='/all')return reply(`IPv4 Address: ${showAddress(d)}\nDefault Gateway: ${gateway(d)??'—'}\nDNS: ${d.host.lease?.dns??'—'}\nMedium: ${wifiUp(lab,d)?'Wi-Fi':'Ethernet'}${voiceVlan(lab,d)?' · voice VLAN '+voiceVlan(lab,d):''}`);
  }
  if(cmd==='ip'&&action==='address') {
    const length=prefixLength(extra?.replace(/^\//,''));
    if(!validIp(target)||length===null||(args[4]&&!validIp(args[4]))||args.length>5)return invalid('Use ip address IP PREFIX [GATEWAY].');
    Object.assign(d.host,{ip:target,prefix:length,gateway:args[4]});delete d.host.lease;return reply('Static IPv4 settings applied.');
  }
  if(['ping','tracert','traceroute'].includes(cmd))return connectivity(lab,d,cmd,action);
  if(cmd==='wifi') {
    if(action==='scan')return reply(lab.devices.filter(x=>x.type==='ap'&&x.radio.enabled&&x.radio.broadcast!==false).map(x=>`${x.radio.ssid}   ${x.radio.key?'WPA2-PSK':'Open'}   ${x.name}   ${apBand(x)} GHz / ch ${apChannel(x)}`).join('\n')||'No SSIDs visible.');
    if(action==='status'){const ap=wifiUp(lab,d);return reply(ap?`Associated to ${ap.radio.ssid} on ${ap.name}`:'Not associated.');}
    if(action==='leave'){delete d.host.wifi;delete d.host.lease;return reply('Wi-Fi disconnected.');}
    if(action==='join')return joinWifi(lab,d,target,extra??'')?reply('Associated. Run ipconfig /renew to request IPv4 settings.'):invalid('Association failed. Check the SSID and key.');
  }
  if(d.type==='phone') {
    if(cmd==='show'&&action==='phone')return reply(`Extension: ${d.host.extension??'unassigned'}\nIPv4: ${showAddress(d)}\nVoice VLAN: ${voiceVlan(lab,d)??'—'}`);
    if(cmd==='extension'&&/^\d{2,8}$/.test(action??'')&&!lab.devices.some(x=>x!==d&&x.type==='phone'&&x.host.extension===action)){
      d.host.extension=action;return reply('Extension assigned.');
    }
    if(cmd==='dial'){
      const dest=lab.devices.find(x=>x!==d&&x.type==='phone'&&x.host.extension===action);
      if(!d.host.extension||!dest||!hostIp(dest))return reply('No callable extension. Verify extensions and IPv4 addressing.');
      const result=ping(lab,d,hostIp(dest));
      return reply(result.ok?`Call connected (simulated): ${d.host.extension} → ${action}`:result.reason,result.path);
    }
  }
  return invalid('Use ? for supported commands on this endpoint.');
}

function globalConfig(lab,d,s,args,c) {
  if(args[0]==='hostname' && validName(args[1])) {
    if(lab.devices.some(x=>x!==d&&x.name.toLowerCase()===args[1].toLowerCase()))return invalid('That hostname is already used.');
    d.name=args[1];return reply();
  }
  if(c.startsWith('interface range ')) {
    const ports=portList(d,args.slice(2).join(' '));
    if(!ports) return invalid('Use a switch interface range such as gi0/2 - 4, gi0/7.');
    s.current=ports;s.mode='range';return reply();
  }
  if(args[0]==='interface'||args[1]==='interface') {
    const name=interfaceName(args.slice(args[0]==='interface'?1:2));
    const base=name?.split('.')[0];
    const physical=models[d.type].ports.includes(name);
    const virtual=(d.type==='router'&&(name?.startsWith('Lo')||(name?.includes('.')&&models.router.ports.includes(base))))||
      (d.type==='switch'&&name?.startsWith('Vlan')&&validVlan(name.slice(4)));
    if(!physical&&!virtual)return invalid('This interface is unavailable on this device.');
    if(args[0]==='no') {
      if(!virtual)return invalid('A physical interface cannot be deleted.');
      delete d.ports[name];return reply();
    }
    if(args[0]==='default'||!d.ports[name])d.ports[name]=physical?{up:d.type==='switch',mode:'access',vlan:1,native:1}:{up:!name.startsWith('Vlan')};
    if(args[0]==='interface'){s.current=name;s.mode='interface';}
    return reply();
  }
  if(c.endsWith(' run')) {
    const protocol=args.at(-2);
    d.discovery??={};d.discovery[protocol]=args[0]!=='no';return reply();
  }
  if(c==='ip routing'||c==='no ip routing'){d.ipv4Routing=args[0]!=='no';return reply();}
  if(d.type==='switch'&&!(args[1]==='route'||args[2]==='route')) {
    const switching=layer2Config(d,null,args,vlanIds)??switchingConfig(d,null,args,c);
    if(switching!==null)return switching?invalid(switching):reply();
    if (c.startsWith('vlan ')&&validVlan(args[1])) {
      s.current=Number(args[1]);d.vlans[s.current]??='VLAN'+s.current;s.mode='vlan';return reply();
    }
    if (c.startsWith('no vlan ')&&validVlan(args[2])&&Number(args[2])!==1) {delete d.vlans[Number(args[2])];return reply();}
    if (c==='no ip default-gateway') {delete d.host.gateway;return reply();}
    if (c.startsWith('ip default-gateway ')&&validIp(args[2])) {d.host.gateway=args[2];return reply();}
    return invalid('Check the switch configuration arguments.');
  }
  const nat=natConfig(d,null,args);
  if(nat)return nat;
  const v6=configureV6(d,null,args,c);
  if(v6)return v6;
  const no=args[0]==='no';
  const words=no?args.slice(1):args;
  if(words[0]==='router'&&integer(words[2],1,65535)) {
    const id=Number(words[2]);
    if(no){if(d.ospf?.id===id)delete d.ospf; return reply();}
    if(d.ospf&&d.ospf.id!==id)return invalid('One OSPF process per router is modeled.');
    d.ospf??={id,networks:[],passive:{}};s.mode='ospf';return reply();
  }
  if(words[0]==='ip'&&words[1]==='access-list') {
    const [, , type, name]=words;
    if(!validName(name)||['__proto__','prototype','constructor'].includes(name.toLowerCase()))return invalid('Choose an access-list name or number.');
    d.acl??={};
    if(no){if(d.acl[name]?.type===type)delete d.acl[name]; return reply();}
    if(d.acl[name]&&d.acl[name].type!==type)return invalid('That access-list name is already in use.');
    d.acl[name]??={type,rules:[]};s.mode='acl';s.current=name;return reply();
  }
  if(words[0]==='access-list') {
    const number=words[1];
    const type=integer(number,1,99)||integer(number,1300,1999)?'standard':integer(number,100,199)||integer(number,2000,2699)?'extended':null;
    if(!type)return invalid('Choose a standard or extended IPv4 ACL number.');
    if(no){if(d.acl)delete d.acl[number];return reply();}
    return configureAcl(d,number,type,words.slice(2));
  }
  if(words[1]==='route') {
    const [, , destination, routeMask, via, ad]=words;
    const prefix=prefixLength(routeMask?.replace(/^\//,''));
    const distance=Number(ad??1);
    const next=validIp(via)?via:undefined;
    const port=next?undefined:interfaceName([via]);
    if(!validIp(destination)||prefix===null||(!next&&!d.ports[port])||!integer(String(distance),1,254))return invalid('Use ip route NETWORK MASK NEXT-HOP [DISTANCE].');
    if(next&&Object.values(d.ports).some(p=>p.address===next))return invalid('Next hop is this router.');
    if(networkAddress(destination,prefix)!==destination)return invalid('Prefix and mask are inconsistent.');
    d.routes=d.routes.filter(r=>!(r.destination===destination&&r.prefix===prefix&&r.next===next&&r.port===port));
    if(!no)d.routes.push({destination,prefix,next,port,distance});
    return reply();
  }
  if(words[0]==='service') {d.dhcpDisabled=no;return reply();}
  if(words[2]==='excluded-address') {
    const [a,b=a]=words.slice(3);
    if(!validIp(a)||!validIp(b)||ipv4(a)>ipv4(b))return invalid('Use ip dhcp excluded-address LOW [HIGH].');
    d.excluded=d.excluded.filter(([x,y])=>x!==a||y!==b);
    if(!no)d.excluded.push([a,b]);
    return reply();
  }
  if(words[2]==='pool'&&validName(words[3])) {
    const name=words[3].toUpperCase();
    if(no){delete d.pools[name];return reply();}
    d.pools[name]??={};s.current=name;s.mode='pool';return reply();
  }
  return invalid('Check the global configuration arguments.');
}

function portConfig(d,name,args,c) {
  const p=d.ports[name];
  const no=args[0]==='no';
  const words=no?args.slice(1):args;
  if(words[0]==='shutdown') {p.up=no;if(no&&p.security)delete p.security.disabled;return reply();}
  if(words[0]==='description') {if(no)delete p.description;else p.description=args.slice(1).join(' ').slice(0,80);return reply();}
  if(words[0]==='speed' && ['auto','10','100','1000'].includes(words[1])) {p.speed=words[1];return reply();}
  if(words[0]==='duplex') {p.duplex=words[1];return reply();}
  if(words[0]==='cdp') {p.cdp=!no;return reply();}
  if(words[0]==='lldp') {p[words[1]==='transmit'?'lldpTx':'lldpRx']=!no;return reply();}
  if(words[1]==='address'&&words[0]==='ip'&&(d.type==='router'||name.startsWith('Vlan')||p.mode==='routed')) {
    if(no){delete p.address;delete p.prefix;return reply();}
    const length=prefixLength(args[3]?.replace(/^\//,''));
    if(!validIp(args[2])||length===null)return invalid('Use ip address IP MASK.');
    p.address=args[2];p.prefix=length;return reply();
  }
  if(d.type==='router') {
    const nat=natConfig(d,name,args);
    if(nat)return nat;
    const v6=configureV6(d,name,args,c);
    if(v6)return v6;
    const ospf=ospfPort(d,name,args,c);
    if(ospf)return ospf;
    if(words[1]==='helper-address'&&validIp(words[2])) {
      if(no){if(p.helper===words[2])delete p.helper;}else p.helper=words[2];
      return reply();
    }
    if(words[1]==='access-group'&&validName(words[2])) {
      p.acl??={};
      if(no){if(p.acl[words[3]]===words[2])delete p.acl[words[3]];}else p.acl[words[3]]=words[2];
      return reply();
    }
    if(words[0]==='encapsulation'&&name.includes('.')) {
      if(no){delete p.tag;delete p.nativeEncapsulation;return reply();}
      if(!validVlan(args[2]))return invalid('Enter VLAN 1–4094.');
      const tag=Number(args[2]), native=args[3]==='native';
      if(Object.entries(d.ports).some(([other,value])=>other!==name&&other.split('.')[0]===name.split('.')[0]&&(value.tag===tag||(native&&value.nativeEncapsulation))))return invalid('That tag or native encapsulation is already used.');
      p.tag=tag;p.nativeEncapsulation=native;return reply();
    }
  }
  if (d.type==='switch'&&!name.startsWith('Vlan')) {
    if(c==='no switchport'){p.mode='routed';delete p.channel;return reply();}
    if(c==='switchport'){p.mode='access';delete p.address;delete p.prefix;return reply();}
    const switching=layer2Config(d,name,args,vlanIds)??switchingConfig(d,name,args,c);
    if(switching!==null)return switching?invalid(switching):reply();
  }
  if(d.type==='switch'&&!name.startsWith('Vlan')&&p.mode!=='routed'&&words[0]==='switchport') {
    if(words[1]==='mode'){p.mode=words[2];return reply();}
    if(words[1]==='nonegotiate'){p.nonegotiate=!no;return reply();}
    const key=words[1]==='access'?'vlan':words[1]==='voice'?'voice':words[2]==='native'?'native':null;
    if(key) {
      if(no){if(key==='voice')delete p.voice;else p[key]=1;return reply();}
      if(!validVlan(words.at(-1)))return invalid('Enter VLAN 1–4094.');
      p[key]=Number(words.at(-1));return reply();
    }
    if(words[2]==='allowed') {
      const operation=words[4];
      if(no||operation==='all'){delete p.allowed;return reply();}
      if(operation==='none'){p.allowed=[];return reply();}
      const ids=vlanIds(words.at(-1));
      if(!ids)return invalid('Use VLAN numbers and ranges such as 10,20-24.');
      if(operation==='add'){if(p.allowed)p.allowed=[...new Set([...p.allowed,...ids])].sort((a,b)=>a-b);}
      else if(operation==='remove'||operation==='except'){
        const blocked=new Set(ids), previous=operation==='except'?undefined:p.allowed;
        p.allowed=(previous??Array.from({length:4094},(_,i)=>i+1)).filter(v=>!blocked.has(v));
      } else p.allowed=ids;
      return reply();
    }
  }
  return invalid('Check the interface configuration arguments.');
}

function saveCommand(d,args,c) {
  if(c==='copy running-config startup-config'||c==='write memory') {d.startup=running(d);return reply('Building configuration...\n[OK]');}
  return null;
}

export function execute(lab,d,s,input) {
  const raw=input.trim();
  if(!raw)return reply();
  if(raw.endsWith('?')&&raw.split('"').length%2===1&&raw.split("'").length%2===1)return reply(commandHelp(d,s,input.slice(0,input.lastIndexOf('?'))).text);
  if(raw.toLowerCase()==='help')return reply(commandHelp(d,s).text);
  const pipe=pipeAt(raw);
  const {args,error}=resolve(grammars[d.type][s.mode],pipe<0?raw:raw.slice(0,pipe).trimEnd());
  if(error)return invalid(error);
  if(pipe>=0){
    const command=args[0]==='do'?args.slice(1):args;
    if(command[0]!=='show')return invalid('Output filters are available on show commands.');
    const filter=resolve(filterGrammar,raw.slice(pipe+1));
    if(filter.error)return invalid(filter.error);
    const result=execute(lab,d,s,raw.slice(0,pipe).trimEnd());
    if(result.text.startsWith('%'))return result;
    const [type,...words]=filter.args;
    if(type==='interface'){
      const name=interfaceName(words);
      if(!name||!d.ports[name])return invalid('This interface does not exist.');
      return reply(filtered(result.text,'section','interface '+name));
    }
    return reply(filtered(result.text,type,words.join(' ')));
  }
  const c=args.join(' ').toLowerCase();
  s.history.push(raw);s.history=s.history.slice(-50);
  if(s.mode==='endpoint')return runEndpoint(lab,d,args);
  if(c==='enable'){s.mode='exec';return reply();}
  if(c==='disable'){s.mode='user';return reply();}
  if(c==='configure terminal'){s.mode='global';return reply();}
  if(c==='exit'||c==='end'){s.mode=c==='end'||s.mode==='global'?'exec':'global';s.current=null;return reply();}
  if(args[0]==='do')args.shift();
  const command=args.join(' ').toLowerCase();
  if(args[0]==='show')return show(lab,d,s,args,command);
  if(['ping','traceroute'].includes(args[0]))return connectivity(lab,d,args[0],args[1]);
  if(s.mode==='exec'){
    const saved=saveCommand(d,args,c);
    if(saved)return saved;
    if(c==='clear ip nat translation *'){if(d.nat)d.nat.translations=[];return reply();}
    if(c==='clear arp-cache'||c==='clear ip arp') {d.arp={};return reply();}
    if(c.startsWith('clear ip arp ')) {if(d.arp)delete d.arp[args[3]];return reply();}
    if(c==='clear mac address-table dynamic') {d.macTable={};return reply();}
    if(c.startsWith('clear ip dhcp binding ')){
      for(const x of lab.devices)if(x.host.lease?.server===d.id&&(args[4]==='*'||x.host.lease.ip===args[4]))delete x.host.lease;
      return reply();
    }
    if(c.startsWith('terminal length ')&&integer(args[2],0,512)) {s.pageLength=Number(args[2]);return reply('Terminal length set for this session.');}
  }
  if(s.mode==='global')return globalConfig(lab,d,s,args,c);
  if(s.mode==='interface')return portConfig(d,s.current,args,c);
  if(s.mode==='range'){
    for (const name of s.current) {
      const result=portConfig(d,name,args,c);
      if(result.text.startsWith('%'))return result;
    }
    return reply();
  }
  if(s.mode==='ospf')return ospfConfig(d,s,args,c);
  if(s.mode==='acl') {
    const list=d.acl[s.current];
    if(!list)return invalid('This access list no longer exists.');
    if(args[0]==='no'&&integer(args[1],1,2147483647)) {list.rules=list.rules.filter(r=>r.sequence!==Number(args[1]));return reply();}
    return configureAcl(d,s.current,list.type,args);
  }
  if(s.mode==='vlan'){
    if(args[0]==='name'){d.vlans[s.current]=args.slice(1).join(' ').slice(0,32);return reply();}
    d.inactiveVlans=(d.inactiveVlans??[]).filter(id=>id!==s.current);
    if(args[0]==='shutdown')d.inactiveVlans.push(s.current);
    return reply();
  }
  if(s.mode==='pool'){
    const p=d.pools[s.current];
    if(args[0]==='network'){
      const length=prefixLength(args[2]?.replace(/^\//,''));
      if(length!==null&&length<=30&&validIp(args[1])&&networkAddress(args[1],length)===args[1]){p.network=args[1];p.prefix=length;return reply();}
    }
    if(args[0]==='default-router'&&validIp(args[1])){p.gateway=args[1];return reply();}
    if(args[0]==='dns-server'&&validIp(args[1])){p.dns=args[1];return reply();}
    if(args[0]==='domain-name'&&/^[a-z0-9.-]+$/i.test(args[1])){p.domain=args[1];return reply();}
    if(args[0]==='lease'&&integer(args[1],0,365)&&integer(args[2]??'0',0,23)&&integer(args[3]??'0',0,59)){p.lease=args.slice(1).join(' ');return reply();}
  }
  return invalid('Check the command arguments for this mode.');
}
