import { deviceById, gateway, hostIp, hostPrefix, ipv4, dotted, prefixLength, linkUp, models, networkAddress, ping, requestDhcp, routeTable, joinWifi, wifiUp, voiceVlan, isHost, mask } from './network.js';

const split = input => input.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map(part=>part.replace(/^(['"])(.*)\1$/,'$2')) ?? [];
const on = value=>value?'on':'off';
const validVlan = id=>/^\d+$/.test(id)&&Number(id)>=1&&Number(id)<=4094;
const invalid = answer=>({text:'% '+answer});
const reply = (text='',path=[])=>({text,path});
const ifaceMatch = /^gi(?:gabitethernet)?(0\/[0-8])(?:\.([1-9]\d{0,3}))?$/i;
const validIp = ip=>ipv4(ip)!==null;
const vlanList = raw=>raw?.split(',').filter(Boolean);
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
  return {mode:['router','switch'].includes(d.type)?'user':'endpoint',current:null};
}

function promptMode(session) {
  return { global:'config',interface:'config-if',vlan:'config-vlan',pool:'dhcp-config' }[session.mode];
}
export function prompt(d,session) {
  const suffix=promptMode(session);
  return d.name+(suffix?`(${suffix})#`:session.mode==='exec'?'#':'>');
}

const modeHelp = {
  user:'enable · ?',
  global:'hostname NAME · interface PORT · vlan ID (switch) · ip route … · ip dhcp pool NAME (router) · end',
  interface:'description TEXT · shutdown · no shutdown · ip address … (router) · encapsulation dot1Q … (subinterface) · switchport … (switch) · do show … · exit',
  vlan:'name TEXT · exit · end',
  pool:'network ADDRESS MASK · default-router ADDRESS · exit · end',
  exec:'show ip interface brief · show interfaces status · show running-config · copy running-config startup-config · configure terminal · ping ADDRESS (router) · disable',
};

function endpointHelp(d) {
  if(d.type==='ap')return 'ssid NAME · security wpa2-psk KEY · radio on · radio off · show wireless';
  return 'ipconfig [/all | /renew | /release] · ip address IP PREFIX GATEWAY · ping IP · tracert IP · wifi scan · wifi join SSID KEY · wifi status · wifi leave'+(d.type==='phone'?' · extension NUMBER · dial NUMBER · show phone':'');
}

function running(d) {
  const rows=[`hostname ${d.name}`];
  for(const [id,name] of Object.entries(d.vlans))if(id!=='1')rows.push('vlan '+id,' name '+name);
  for(const [name,p] of Object.entries(d.ports)) {
    rows.push('interface '+name);
    if(p.description)rows.push(' description '+p.description);
    if(p.address)rows.push(` ip address ${p.address} ${dotted(mask(p.prefix))}`);
    if(p.tag)rows.push(' encapsulation dot1Q '+p.tag);
    if(d.type==='switch') {
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
  for(const r of d.routes)rows.push(`ip route ${r.destination} ${dotted(mask(r.prefix))} ${r.next}${r.distance!==1?' '+r.distance:''}`);
  for(const [a,b] of d.excluded)rows.push('ip dhcp excluded-address '+a+' '+b);
  for(const [name,p] of Object.entries(d.pools)) {
    rows.push('ip dhcp pool '+name);
    if(p.network)rows.push(` network ${p.network} ${dotted(mask(p.prefix))}`);
    if(p.gateway)rows.push(' default-router '+p.gateway);
  }
  return rows.join('\n');
}

function connectivity(lab,d,command,ip) {
  const result=ping(lab,d,ip);
  const path=result.path.map(id=>deviceById(lab,id)?.name).join(' → ');
  if(!result.ok)return reply(`${command==='ping'?'.....\nSuccess rate is 0 percent (0/5)\n':''}${result.reason}\nPath: ${path}`,result.path);
  return reply((command==='ping'?'!!!!!\nSuccess rate is 100 percent (5/5)\n':'')+'Path: '+path,result.path);
}

function show(lab,d,c) {
  if(c==='show running-config')return reply(running(d));
  if(c==='show startup-config')return reply(d.startup??'startup-config is not present');
  if(c==='show ip interface brief')return reply(['Interface     IP-Address       Status                  Protocol',
    ...Object.entries(d.ports).map(([n,p])=>`${n.padEnd(13)} ${(p.address??'unassigned').padEnd(16)} ${(p.up?(linkUp(lab,d,n)?'up':'down'):'administratively down').padEnd(23)} ${linkUp(lab,d,n)?'up':'down'}`)].join('\n'));
  if(c==='show interfaces status')return reply(['Port          State         VLAN / mode',
    ...Object.entries(d.ports).map(([name,p])=>`${name.padEnd(13)} ${(linkUp(lab,d,name)?'connected':p.up?'notconnect':'disabled').padEnd(13)} ${d.type==='switch'?(p.mode==='trunk'?'trunk':p.vlan+(p.voice?' / voice '+p.voice:'')):'routed'}`)].join('\n'));
  if(c==='show vlan brief'&&d.type==='switch')return reply(['VLAN  Name              Access ports',
    ...Object.entries(d.vlans).map(([id,name])=>`${id.padEnd(5)} ${name.padEnd(17)} ${Object.entries(d.ports).filter(([,p])=>p.mode==='access'&&(p.vlan===Number(id)||p.voice===Number(id))).map(([key])=>key).join(', ')}`)].join('\n'));
  if(c==='show interfaces trunk'&&d.type==='switch')return reply(['Port     Status     Native  Allowed VLANs',
    ...Object.entries(d.ports).filter(([,p])=>p.mode==='trunk').map(([name,p])=>`${name.padEnd(8)} ${(linkUp(lab,d,name)?'trunking':'down').padEnd(10)} ${String(p.native).padEnd(7)} ${p.allowed?.join(',')??'all'}`)].join('\n'));
  if(c==='show ip route'&&d.type==='router')return reply(routeTable(lab,d).map(r=>r.next?`S${r.prefix?' ':'*'} ${r.destination}/${r.prefix} [${r.distance}/0] via ${r.next}, ${r.port}`:`C  ${r.destination}/${r.prefix} is directly connected, ${r.port}`).join('\n')||'No active routes.');
  if(c==='show ip dhcp binding'&&d.type==='router')return reply(lab.devices.filter(x=>x.host.lease?.server===d.id).map(x=>`${x.host.lease.ip}   ${x.name}   Automatic`).join('\n')||'No DHCP bindings.');
  return invalid('That show command is unavailable on this device.');
}

function runEndpoint(lab,d,args) {
  const [word,parameter,target,extra]=args;
  const cmd=word.toLowerCase();
  const action=cmd==='ssid'?parameter:parameter?.toLowerCase();
  if(d.type==='ap') {
    if(cmd==='show'&&action==='wireless')return reply(`Radio: ${on(d.radio.enabled)}\nSSID: ${d.radio.ssid}\nSecurity: ${d.radio.key?'WPA2-PSK':'Open'}\nEthernet: ${linkUp(lab,d,'Eth0')?'up':'down'}\nClients: ${lab.devices.filter(x=>isHost(x)&&wifiUp(lab,x)===d).map(x=>x.name).join(', ')||'none'}`);
    if(cmd==='ssid'&&action&&args.length===2&&new TextEncoder().encode(action).length<=32){d.radio.ssid=action;return reply('SSID set.');}
    if(cmd==='security'&&action==='wpa2-psk'&&/^[\x20-\x7e]{8,63}$/.test(target??'')&&args.length===3){d.radio.key=target;return reply('WPA2-Personal configured.');}
    if(cmd==='radio'&&['on','off'].includes(action)){d.radio.enabled=action==='on';return reply('Radio '+action+'.');}
    return invalid('Use ? for available AP controls.');
  }

  if(cmd==='ipconfig') {
    if(action==='/renew'){const result=requestDhcp(lab,d);return reply(result.ok?`DHCP lease: ${result.ip} from ${result.server}`:result.reason,result.path);}
    if(action==='/release'){delete d.host.lease;return reply('DHCP lease released.');}
    if(!action||action==='/all')return reply(`IPv4 Address: ${showAddress(d)}\nDefault Gateway: ${gateway(d)??'—'}\nMedium: ${wifiUp(lab,d)?'Wi-Fi':'Ethernet'}${voiceVlan(lab,d)?' · voice VLAN '+voiceVlan(lab,d):''}`);
  }
  if(cmd==='ip'&&action==='address') {
    const length=prefixLength(extra?.replace(/^\//,''));
    if(!validIp(target)||length===null||(args[4]&&!validIp(args[4]))||args.length>5)return invalid('Use ip address IP PREFIX [GATEWAY].');
    Object.assign(d.host,{ip:target,prefix:length,gateway:args[4]});delete d.host.lease;return reply('Static IPv4 settings applied.');
  }
  if(['ping','tracert','traceroute'].includes(cmd))return connectivity(lab,d,cmd,action);
  if(cmd==='wifi') {
    if(action==='scan')return reply(lab.devices.filter(x=>x.type==='ap'&&x.radio.enabled).map(x=>`${x.radio.ssid}   ${x.radio.key?'WPA2-PSK':'Open'}   ${x.name}`).join('\n')||'No SSIDs visible.');
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
  if(args[0].toLowerCase()==='hostname' && /^[a-z0-9][\w-]{0,31}$/i.test(args[1]??'')&&args.length===2) {
    if(lab.devices.some(x=>x!==d&&x.name.toLowerCase()===args[1].toLowerCase()))return invalid('That hostname is already used.');
    d.name=args[1];return reply();
  }
  if(args[0].toLowerCase()==='interface') {
    const match=ifaceMatch.exec(args[1]??'');
    if(!match||args.length!==2)return invalid('Choose a physical GigabitEthernet interface.');
    const base='Gi'+match[1];
    if(!models[d.type].ports.includes(base))return invalid('This port does not exist.');
    const tag=match[2];
    if(tag&&d.type!=='router')return invalid('Subinterfaces are modeled on routers only.');
    s.current=tag?base+'.'+tag:base;
    d.ports[s.current]??={up:true};
    s.mode='interface';return reply();
  }
  if(c.startsWith('vlan ')&&validVlan(args[1])&&d.type==='switch') {
    s.current=Number(args[1]);d.vlans[s.current]??='VLAN'+s.current;s.mode='vlan';return reply();
  }
  if(d.type!=='router')return invalid('Use ? for configuration commands on this switch.');
  if(c.startsWith('ip route ')||c.startsWith('no ip route ')) {
    const remove=c.startsWith('no ');
    const routeArgs=args.slice(remove?3:2);
    const [destination,routeMask,next,ad]=routeArgs;
    const prefix=prefixLength(routeMask?.replace(/^\//,''));
    const distance=ad===undefined?1:Number(ad);
    if(routeArgs.length<3||routeArgs.length>4||!validIp(destination)||prefix===null||!validIp(next)||!Number.isInteger(distance)||distance<1||distance>254)return invalid('Use ip route NETWORK MASK NEXT-HOP [DISTANCE].');
    if(Object.values(d.ports).some(p=>p.address===next))return invalid('Next hop is this router.');
    if(networkAddress(destination,prefix)!==destination)return invalid('Prefix and mask are inconsistent.');
    d.routes=d.routes.filter(r=>!(r.destination===destination&&r.prefix===prefix&&r.next===next));
    if(!remove)d.routes.push({destination,prefix,next,distance});
    return reply();
  }
  if(c.startsWith('ip dhcp excluded-address ')) {
    const [a,b=a]=args.slice(3);
    if(!validIp(a)||!validIp(b)||ipv4(a)>ipv4(b))return invalid('Use ip dhcp excluded-address LOW [HIGH].');
    if(!d.excluded.some(([x,y])=>x===a&&y===b))d.excluded.push([a,b]);
    return reply();
  }
  if(c.startsWith('ip dhcp pool ')&&/^[\w-]{1,24}$/.test(args[3]??'')&&args.length===4&&!['__proto__','constructor','prototype'].includes(args[3])) {
    s.current=args[3].toUpperCase();d.pools[s.current]??={};s.mode='pool';return reply();
  }
  return invalid('Use ? for supported global commands.');
}

function portConfig(d,s,args,c) {
  const p=d.ports[s.current];
  if(c==='shutdown'||c==='no shutdown'){p.up=c==='no shutdown';return reply();}
  if(c.startsWith('description ')){p.description=args.slice(1).join(' ').slice(0,80);return reply();}
  if(d.type==='router'){
    if(c.startsWith('ip address ')){
      const length=prefixLength(args[3]?.replace(/^\//,''));
      if(!validIp(args[2])||length===null||args.length!==4)return invalid('Use ip address IP MASK.');
      p.address=args[2];p.prefix=length;return reply();
    }
    if(c==='no ip address'){delete p.address;delete p.prefix;return reply();}
    if(c.startsWith('encapsulation dot1q ')&&s.current.includes('.')&&validVlan(args[2])&&args.length===3){
      const tag=Number(args[2]);
      if(Object.entries(d.ports).some(([name,other])=>name!==s.current&&name.split('.')[0]===s.current.split('.')[0]&&other.tag===tag))return invalid('This VLAN tag is already used on the parent.');
      p.tag=tag;return reply();
    }
  }
  if(d.type==='switch'){
    if(c==='switchport mode access'||c==='switchport mode trunk'){p.mode=args[2].toLowerCase();return reply();}
    if(c==='no switchport voice vlan'){delete p.voice;return reply();}
    const values=[['switchport access vlan ','vlan'],['switchport voice vlan ','voice'],['switchport trunk native vlan ','native']];
    for(const [key,field] of values)if(c.startsWith(key)&&validVlan(args.at(-1))){p[field]=Number(args.at(-1));return reply();}
    if(c==='switchport trunk allowed vlan all'){delete p.allowed;return reply();}
    if(c.startsWith('switchport trunk allowed vlan ')){
      const list=vlanList(args.at(-1));
      if(list?.length&&list.every(validVlan)){
        const operation=args[4].toLowerCase(), ids=list.map(Number);
        if(args.length===5)p.allowed=[...new Set(ids)];
        else if(operation==='add'&&p.allowed)p.allowed=[...new Set([...p.allowed,...ids])];
        else if(operation==='remove')p.allowed=(p.allowed??Array.from({length:4094},(_,i)=>i+1)).filter(v=>!ids.includes(v));
        else if(operation!=='add')return invalid('Use an explicit VLAN list, add, or remove.');
        return reply();
      }
    }
  }
  return invalid('Use ? for supported commands in interface mode.');
}

export function execute(lab,d,s,input) {
  const args=split(input);
  const c=args.join(' ').toLowerCase();
  if(!c)return reply();
  if(c==='?'||c==='help')return reply(s.mode==='endpoint'?endpointHelp(d):modeHelp[s.mode]);
  if(s.mode==='endpoint')return runEndpoint(lab,d,args);
  const isConfig=Boolean(promptMode(s));
  if(c==='enable'||c==='en'){
    if(s.mode!=='user')return invalid('Enable is used from user EXEC.');
    s.mode='exec';return reply();
  }
  if(c==='disable'&&s.mode==='exec'){s.mode='user';return reply();}
  if((c==='configure terminal'||c==='conf t')&&s.mode==='exec'){s.mode='global';return reply();}
  if((c==='exit'||c==='end')&&isConfig){s.mode=c==='end'||s.mode==='global'?'exec':'global';s.current=null;return reply();}
  if(isConfig&&c.startsWith('do show '))return show(lab,d,c.slice(3));
  if(s.mode==='exec'){
    if(c.startsWith('show '))return show(lab,d,c==='show run'?'show running-config':c);
    if(c==='copy running-config startup-config'||c==='write memory'){d.startup=running(d);return reply('Building configuration...\n[OK]');}
    if(d.type==='router'&&['ping','traceroute'].includes(args[0].toLowerCase()))return connectivity(lab,d,args[0].toLowerCase(),args[1]);
  }
  if(s.mode==='global')return globalConfig(lab,d,s,args,c);
  if(s.mode==='interface')return portConfig(d,s,args,c);
  if(s.mode==='vlan'&&c.startsWith('name ')){d.vlans[s.current]=args.slice(1).join(' ').slice(0,32);return reply();}
  if(s.mode==='pool'){
    const p=d.pools[s.current];
    if(c.startsWith('network ')&&validIp(args[1])){
      const length=prefixLength(args[2]?.replace(/^\//,''));
      if(length!==null&&length<=30&&networkAddress(args[1],length)===args[1]){p.network=args[1];p.prefix=length;return reply();}
      return invalid('Use network NETWORK MASK with a valid prefix length.');
    }
    if(c.startsWith('default-router ')&&validIp(args[1])){p.gateway=args[1];return reply();}
  }
  return invalid('Command unavailable in this mode. Type ? for options.');
}
