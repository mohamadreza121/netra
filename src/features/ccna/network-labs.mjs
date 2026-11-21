import { set, change, read, field, lines } from './engine.mjs';

const sw = 'SW1';
const r = 'R1';
const r2 = 'R2';
const pc = 'PC1';
const enable = device => [device, 'enable', 'Enter privileged EXEC mode. The prompt changes from > to #.'];
const config = device => [device, 'configure terminal', 'Enter global configuration mode.'];
const end = device => [device, 'end', 'Return to privileged EXEC to verify your work.'];
const exit = device => [device, 'exit', 'Return to global configuration.'];
const port = (device, name) => [device, 'interface ' + name, 'Select the interface to configure.'];
const show = (device, cmd, explanation, report) => [device, cmd, explanation, read(report)];
export const helpers = { enable, config, end, exit, port, show, sw, r, r2, pc };

function accessVlan(state, device) {
  return lines('VLAN  Name          Status    Ports', '1     default       active',
    state[device + ':vlan'] ? `10    ${field(state, device + ':name', 'VLAN0010').padEnd(13)} active    ${state[device + ':access'] ? 'Gi0/1' : ''}` : '',
    state[device + ':voice'] ? '20    VOICE         active    Gi0/1' : '');
}

function interfaceBrief(s) {
  return lines('Interface              IP-Address       Status                 Protocol',
    `GigabitEthernet0/0     ${field(s, 'address', 'unassigned').padEnd(16)} ${s.up ? 'up                     up' : 'administratively down  down'}`);
}

const staticRoutes = [
  ['0.0.0.0 0.0.0.0 192.0.2.2', '0.0.0.0/0', '192.0.2.2', 1, 'Install a default route.'],
  ['10.20.0.0 255.255.0.0 192.0.2.2', '10.20.0.0/16', '192.0.2.2', 1, 'Route the remote network through the primary router.'],
  ['10.20.4.7 255.255.255.255 192.0.2.3', '10.20.4.7/32', '192.0.2.3', 1, 'Prefer a specific next hop for this host.'],
  ['10.20.0.0 255.255.0.0 192.0.2.3 200', '10.20.0.0/16', '192.0.2.3', 200, 'Add a floating static route with a higher administrative distance.']
];
const routes6 = [
  ['::/0 2001:db8:12::2', '::/0', 1], ['2001:db8:20::/64 2001:db8:12::2', '2001:db8:20::/64', 1],
  ['2001:db8:20::7/128 2001:db8:12::3', '2001:db8:20::7/128', 1], ['2001:db8:20::/64 2001:db8:12::3 200', '2001:db8:20::/64', 200]
];

function ipv4Table(state) {
  const picked = new Map();
  for (const [args, prefix, hop, distance] of staticRoutes) {
    if (state[args] && !(state.primaryRemoved && args === staticRoutes[1][0]) && !picked.has(prefix)) {
      picked.set(prefix, `S${prefix === '0.0.0.0/0' ? '*' : ' '} ${prefix} [${distance}/0] via ${hop}`);
    }
  }
  return lines(picked.has('0.0.0.0/0') ? 'Gateway of last resort is 192.0.2.2' : 'Gateway of last resort is not set',
    'C  192.0.2.0/24 is directly connected, GigabitEthernet0/0', ...picked.values());
}

export function ospfReady(s) {
  return Boolean(s.rid1 && s.rid2 && s.net1 && s.net2 && !s.ospfShutdown && Boolean(s.p2p1) === Boolean(s.p2p2));
}

function ospfNeighbors(s, device) {
  if (!ospfReady(s)) return 'No OSPF neighbors.';
  const other = device === r ? 2 : 1;
  const role = s.p2p1 ? '-' : other === 2 ? 'BDR' : 'DR';
  return lines('Neighbor ID     Pri  State       Address        Interface',
    `${s['rid' + other].padEnd(16)} 1   FULL/${role.padEnd(6)} 10.0.12.${other}      Gi0/0`);
}

export const networkLabs = [
  {
    id: 'device-setup', domain: 1, title: 'Device setup and interfaces', objectives: '1.4 · 1.6', source: 'Vol. 1 · Ch. 4–7, 15–16',
    devices: [r], topology: ['R1 Gi0/0', 'PC1'], task: 'Bring up a routed port, inspect its IP and link settings, and save the configuration.',
    initial: {}, steps: [
      enable(r), config(r), [r, 'hostname EDGE1', 'Change the name shown at the CLI prompt.', set('hostname:R1', 'EDGE1')],
      port(r, 'GigabitEthernet0/0'), [r, 'description User LAN', 'Record the purpose of this interface.', set('desc', 'User LAN')],
      [r, 'ip address 192.168.10.1 255.255.255.0', 'Assign an IPv4 address and /24 mask.', change({address:'192.168.10.1',mask:'255.255.255.0'})],
      [r, 'speed auto', 'Let Ethernet negotiate link speed.', set('speed', 'auto')],
      [r, 'duplex auto', 'Let Ethernet negotiate duplex.', set('duplex','auto')],
      [r, 'no shutdown', 'Enable the interface on the connected lab link.', set('up', true)],
      end(r), show(r, 'show ip interface brief', 'Check address, administrative state and line protocol.', interfaceBrief),
      show(r,'show interfaces GigabitEthernet0/0','Inspect status, duplex, speed and error counters.',s => lines(
        `GigabitEthernet0/0 is ${s.up ? 'up, line protocol is up' : 'administratively down, line protocol is down'}`,
        `  Description: ${field(s, 'desc')}`, `  Duplex: ${field(s,'duplex')} · Speed: ${field(s,'speed')}`, '  0 CRC, 0 collisions')),
      show(r,'show interfaces description','Locate the interface by its description.',s=>`Gi0/0  ${s.up?'up/up':'admin down'}  ${field(s,'desc')}`),
      [r,'show running-config','Inspect the configuration you applied.'],
      [r,'copy running-config startup-config','Store the running configuration as startup configuration.'],
      [r,'show startup-config','Confirm the saved copy contains your interface and hostname.']
    ]
  },
  {
    id:'forwarding', domain:1, title:'Ethernet learning and client checks', objectives:'1.10 · 1.13', source:'Vol. 1 · Ch. 1–5',
    devices:[sw,pc], topology:['PC1', 'SW1', 'PC2'], task:'Send traffic from a client and watch the switch learn source MAC addresses.',
    steps:[
      [pc,'ipconfig /all','Inspect the Windows client’s mask, gateway and MAC address.',read(()=>lines('IPv4 Address . . . 192.168.10.11','Subnet Mask  . . . 255.255.255.0','Default Gateway  . 192.168.10.1','Physical Address . 02-00-00-00-00-11'))],
      [pc,'ip addr show','Read the Linux equivalent on this practice client.',read(()=> '2: eth0: <UP,LOWER_UP>\n    inet 192.168.10.11/24 scope global eth0')],
      [pc,'ip route','Read the Linux default route.',read(()=> 'default via 192.168.10.1 dev eth0')],
      [pc,'ifconfig en0','Read an interface address and subnet mask using a macOS-style command.',read(()=> 'en0: flags=8863<UP,BROADCAST,RUNNING>\n    inet 192.168.10.11 netmask 0xffffff00')],
      enable(sw), show(sw,'show mac address-table','Inspect the initially empty dynamic table.',s=>s.learned ? lines('VLAN  MAC address       Type      Ports','10    0200.0000.0011    DYNAMIC   Gi0/1','10    0200.0000.0012    DYNAMIC   Gi0/2') : 'No dynamic MAC addresses learned.'),
      [pc,'ping 192.168.10.12','Send traffic both ways between hosts in VLAN 10.',s=>{s.learned=true;return 'Reply from 192.168.10.12: bytes=32 time<1ms';}],
      show(sw,'show mac address-table dynamic','Verify the switch recorded both source addresses.',s=>s.learned ? '10  0200.0000.0011  DYNAMIC  Gi0/1\n10  0200.0000.0012  DYNAMIC  Gi0/2' : 'No dynamic MAC addresses learned.'),
      [sw,'clear mac address-table dynamic','Clear learned entries so the next frames must be learned again.',set('learned',false)],
      show(sw,'show mac address-table','Confirm the dynamic entries were cleared.',s=>s.learned?'2 dynamic entries':'No dynamic MAC addresses learned.')
    ]
  },
  {
    id:'vlans', domain:2, title:'VLANs, voice VLAN and 802.1Q trunks', objectives:'2.1 · 2.2', source:'Vol. 1 · Ch. 8',
    devices:[sw,'SW2'], topology:['SW1 Gi0/24', '802.1Q trunk', 'SW2 Gi0/24'], task:'Create a staff VLAN on both switches, configure a voice port, and match trunk settings.',
    steps:[...['SW1','SW2'].flatMap(device => [
      enable(device), config(device), [device,'vlan 10','Create normal-range VLAN 10.',set(device + ':vlan',true)],
      [device,'name STAFF','Assign a descriptive VLAN name.',set(device + ':name','STAFF')], exit(device),
      ...(device === sw ? [[device,'vlan 20','Create the voice VLAN.',set(device + ':voice',true)],[device,'name VOICE','Label the voice VLAN.'],exit(device)] : []),
      [device,'vlan 99','Create a dedicated native VLAN.',set(device + ':nativeVlan',true)],exit(device),
      port(device,'GigabitEthernet0/1'), [device,'switchport mode access','Make this an access port.',set(device + ':mode','access')],
      [device,'switchport access vlan 10','Assign the port to data VLAN 10.',set(device + ':access',true)],
      ...(device === sw ? [[device,'switchport voice vlan 20','Tag phone traffic in VLAN 20.',set('voicePort',true)]] : []),
      exit(device), port(device,'GigabitEthernet0/24'), [device,'switchport mode trunk','Enable static 802.1Q trunking.',set(device + ':trunk',true)],
      [device,'switchport trunk native vlan 99','Use VLAN 99 for native traffic.',set(device + ':native',99)],
      [device,'switchport trunk allowed vlan 10,20,99','Restrict the trunk’s allowed VLAN list.',set(device + ':allowed','10,20,99')],
      [device,'switchport nonegotiate','Disable DTP negotiation on the manually configured trunk.',set(device + ':dtp','off')],
      end(device), show(device,'show vlan brief','Check access-port membership.',s=>accessVlan(s,device))
    ]),
    show(sw,'show interfaces trunk','Verify trunk status, native VLAN and allowed list.',s=>s['SW1:trunk']&&s['SW2:trunk']?`Port     Encapsulation  Status     Native vlan\nGi0/24   802.1q         trunking   ${field(s,'SW1:native',1)}\nAllowed VLANs: ${field(s,'SW1:allowed','all')}`:'No trunks are operational.'),
    show(sw,'show interfaces GigabitEthernet0/1 switchport','Verify data and voice VLANs on the edge port.',s=>lines(`Administrative Mode: ${field(s,'SW1:mode','dynamic auto')}`,`Access Mode VLAN: ${s['SW1:access']?10:1}`,`Voice VLAN: ${s.voicePort?20:'none'}`))
    ]
  },
  {
    id:'intervlan',domain:2,title:'Inter-VLAN routing',objectives:'2.1.c',source:'Vol. 1 · Ch. 17',
    devices:[r,sw], topology:['VLAN 10 / VLAN 20', '802.1Q', 'R1'],task:'Build router-on-a-stick subinterfaces and a switch virtual interface.',
    steps:[
      enable(r),config(r),port(r,'GigabitEthernet0/0'),[r,'no shutdown','Enable the parent link.',set('parent',true)],exit(r),
      ...[10,20].flatMap(vlan=>[port(r,`GigabitEthernet0/0.${vlan}`),[r,`encapsulation dot1Q ${vlan}`,'Bind the tag to the subinterface.',set('tag'+vlan,true)],[r,`ip address 192.168.${vlan}.1 255.255.255.0`,'Assign the VLAN default gateway.',set('ip'+vlan,`192.168.${vlan}.1`)],exit(r)]),
      end(r),show(r,'show ip interface brief','Verify both subinterfaces are active.',s=>[10,20].map(n=>`Gi0/0.${n}  ${field(s,'ip'+n,'unassigned')}  ${s.parent&&s['tag'+n]?'up/up':'down/down'}`).join('\n')),
      enable(sw),config(sw),[sw,'ip routing','Enable routing on the multilayer switch.',set('routing',true)],
      port(sw,'Vlan 30'),[sw,'ip address 192.168.30.1 255.255.255.0','Address the SVI. VLAN 30 already has an active member in this scenario.',set('svi','192.168.30.1')],
      [sw,'no shutdown','Bring the SVI administratively up.',set('sviUp',true)],end(sw),
      show(sw,'show ip route connected','Verify VLAN 30 appears as a connected route.',s=>s.svi&&s.sviUp&&s.routing?'C 192.168.30.0/24 is directly connected, Vlan30':'No connected routes.')
    ]
  },
  {
    id:'discovery',domain:2,title:'CDP and LLDP',objectives:'2.3',source:'Vol. 2 · Ch. 9',
    devices:[sw],topology:['SW1 Gi0/1','SW2 Gi0/1'],task:'Enable neighbor discovery, inspect advertised details, then disable it on one interface.',
    steps:[
      enable(sw),config(sw),[sw,'cdp run','Enable CDP globally.',set('cdp',true)],[sw,'lldp run','Enable LLDP globally.',set('lldp',true)],
      port(sw,'GigabitEthernet0/1'),[sw,'cdp enable','Enable CDP on this interface.',set('cdpPort',true)],
      [sw,'lldp transmit','Allow outbound LLDP advertisements.',set('tx',true)],[sw,'lldp receive','Allow inbound LLDP advertisements.',set('rx',true)],end(sw),
      show(sw,'show cdp neighbors detail','Read the neighbor and management address.',s=>s.cdp&&s.cdpPort?'Device ID: SW2\nIP address: 192.168.99.12\nInterface: GigabitEthernet0/1':'No CDP neighbors.'),
      show(sw,'show lldp neighbors detail','Read the system name and remote port advertised by LLDP.',s=>s.lldp&&s.rx?'System Name: SW2\nLocal Intf: Gi0/1\nPort id: Gi0/1':'No LLDP neighbors.'),
      config(sw),port(sw,'GigabitEthernet0/1'),[sw,'no cdp enable','Stop CDP on the interface.',set('cdpPort',false)],[sw,'no lldp receive','Stop accepting LLDP advertisements on the interface.',set('rx',false)],end(sw),
      show(sw,'show cdp neighbors','Confirm CDP no longer shows a neighbor in this lab.',s=>s.cdp&&s.cdpPort?'SW2  Gi0/1':'No CDP neighbors.'),
      show(sw,'show lldp neighbors','Confirm LLDP no longer shows a neighbor.',s=>s.lldp&&s.rx?'SW2  Gi0/1':'No LLDP neighbors.')
    ]
  },
  {
    id:'etherchannel',domain:2,title:'Layer 2 and Layer 3 LACP',objectives:'2.4',source:'Vol. 1 · Ch. 10',
    devices:[sw],topology:['SW1 Gi0/1–2','Port-channel 1','Passive peer'],task:'Bundle a Layer 2 trunk and a separate Layer 3 routed link using LACP.',
    steps:[
      enable(sw),config(sw),[sw,'interface range GigabitEthernet0/1 - 2','Select two physical members.'],
      [sw,'switchport mode trunk','Use a consistent Layer 2 mode on both members.',set('trunk',true)],[sw,'channel-group 1 mode active','Actively send LACP PDUs for bundle 1.',set('l2',true)],exit(sw),
      port(sw,'Port-channel1'),[sw,'switchport trunk allowed vlan 10,20','Set the allowlist on the logical trunk.',set('allowed','10,20')],exit(sw),
      [sw,'interface range GigabitEthernet0/3 - 4','Select the routed bundle members.'],[sw,'no switchport','Make the physical ports routed.',set('l3Routed',true)],
      [sw,'channel-group 2 mode passive','Respond to the active peer on this pair.',set('l3',true)],exit(sw),
      port(sw,'Port-channel2'),[sw,'no switchport','Make the logical channel routed.',set('po2Routed',true)],[sw,'ip address 192.0.2.1 255.255.255.252','Configure the IP on the port-channel.',set('po2ip','192.0.2.1')],end(sw),
      show(sw,'show etherchannel summary','Read S/R for layer, U for in use, and P for bundled.',s=>lines('Group  Port-channel  Protocol  Ports',...(s.trunk&&s.l2?['1      Po1(SU)       LACP      Gi0/1(P) Gi0/2(P)']:[]),...(s.l3&&s.l3Routed&&s.po2Routed?['2      Po2(RU)       LACP      Gi0/3(P) Gi0/4(P)']:[]))),
      show(sw,'show lacp neighbor','Verify the simulated neighbors on the paired links.',s=>lines(s.l2?'Po1   Gi0/1, Gi0/2  Partner passive':'No Po1 partner',s.l3?'Po2   Gi0/3, Gi0/4  Partner active':'No Po2 partner')),
      show(sw,'show interfaces Port-channel2','Inspect the routed bundle and IP.',s=>`Port-channel2 is ${s.po2Routed&&s.l3?'up':'down'}\nInternet address is ${field(s,'po2ip')}`)
    ]
  },
  {
    id:'spanning-tree',domain:2,title:'Rapid PVST+ and loop protection',objectives:'2.5',source:'Vol. 1 · Ch. 9–10',
    devices:[sw,'SW2'],topology:['SW1','VLAN 10 redundant links','SW2'],task:'Set root preferences and assign the correct protection to each port role.',
    steps:[
      enable(sw),config(sw),[sw,'spanning-tree mode rapid-pvst','Run one rapid spanning-tree instance per VLAN.',set('rapid',true)],
      [sw,'spanning-tree vlan 10 root primary','Set this switch as the preferred root for VLAN 10.',set('root',true)],
      port(sw,'GigabitEthernet0/1'),[sw,'spanning-tree portfast','Enable immediate forwarding on a host-facing port.',set('fast',true)],
      [sw,'spanning-tree bpduguard enable','Protect the edge port from an unexpected switch BPDU.',set('guard',true)],exit(sw),
      port(sw,'GigabitEthernet0/2'),[sw,'spanning-tree guard root','Stop this downstream port becoming a root port.',set('rootGuard',true)],exit(sw),
      port(sw,'GigabitEthernet0/3'),[sw,'spanning-tree guard loop','Prevent a non-designated link forwarding after loss of BPDUs.',set('loopGuard',true)],exit(sw),
      port(sw,'GigabitEthernet0/4'),[sw,'spanning-tree bpdufilter enable','Inspect interface-level BPDU filtering on an isolated lab port.',set('filter',true)],end(sw),
      enable('SW2'),config('SW2'),['SW2','spanning-tree vlan 10 root secondary','Give the backup switch a higher priority than the primary root.',set('secondary',true)],end('SW2'),
      show(sw,'show spanning-tree vlan 10','Check root bridge and designated/forwarding ports.',s=>lines(`VLAN0010  Protocol: ${s.rapid?'rstp':'ieee'}`,s.root?'This bridge is the root':'Root is the peer','Gi0/1  Desg FWD',`Gi0/2  Desg FWD  ${s.rootGuard?'Root guard':''}`)),
      show('SW2','show spanning-tree vlan 10','Identify the root port and alternate/discarding redundant port.',s=>s.root?lines('Root ID: SW1','Gi0/2  Root FWD','Gi0/3  Altn BLK',s.secondary?'Secondary root priority configured':''):'Root election not configured.'),
      show(sw,'show spanning-tree interface GigabitEthernet0/1 detail','Check PortFast and BPDU Guard.',s=>lines(`PortFast: ${s.fast?'enabled':'disabled'}`,`BPDU Guard: ${s.guard?'enabled':'disabled'}`)),
      show(sw,'show spanning-tree inconsistentports','Review the inconsistency list in a healthy topology.',()=> 'Number of inconsistent ports (segments) in the system: 0')
    ]
  },
  {
    id:'ipv4-static',domain:3,title:'IPv4 static routing and failover',objectives:'3.1 · 3.2 · 3.3',source:'Vol. 1 · Ch. 13–18',
    devices:[r],topology:['R1', '192.0.2.0/24 transit', 'Primary .2 / Backup .3'],task:'Configure default, network, host and floating routes. Remove the primary to see failover.',
    steps:[enable(r),config(r),...staticRoutes.map(([args,,, ,why])=>[r,'ip route '+args,why,s=>{s[args]=true;if(args===staticRoutes[1][0])s.primaryRemoved=false;}]),end(r),
      show(r,'show ip route','Read protocol codes, route prefix, distance and next hop.',ipv4Table),
      show(r,'show ip route 10.20.4.7','The /32 takes precedence over the covering /16.',s=>s[staticRoutes[2][0]]?'Routing entry for 10.20.4.7/32\n  Known via "static", distance 1, metric 0\n  * 192.0.2.3':ipv4Table(s)),
      config(r),[r,'no ip route 10.20.0.0 255.255.0.0 192.0.2.2','Withdraw the primary static route in this lab.',set('primaryRemoved',true)],end(r),
      show(r,'show ip route static','Verify the floating backup now appears with distance 200.', s=>ipv4Table(s).split('\n').filter(line=>line.startsWith('S')).join('\n')||'No static routes.')]
  },
  {
    id:'ipv6',domain:3,title:'IPv6 addressing and static routing',objectives:'1.8 · 1.9 · 3.3',source:'Vol. 1 · Ch. 22–25',
    devices:[r],topology:['R1 Gi0/0','2001:db8:12::/64','R2 / R3'],task:'Enable IPv6 forwarding, configure link-local and global unicast addresses, and verify four route types.',
    steps:[
      enable(r),config(r),[r,'ipv6 unicast-routing','Enable IPv6 forwarding.',set('forward6',true)],port(r,'GigabitEthernet0/0'),
      [r,'ipv6 address 2001:db8:12::1/64','Set a global unicast address from the documentation prefix.',set('global6','2001:db8:12::1/64')],
      [r,'ipv6 address fe80::1 link-local','Set a predictable link-local address.',set('link6','FE80::1')],
      [r,'no shutdown','Enable the link.',set('ipv6Up',true)],exit(r),
      ...routes6.map(([args,prefix,ad])=>[r,'ipv6 route '+args,`Configure ${prefix} with administrative distance ${ad}.`,set('v6:'+args,true)]),end(r),
      show(r,'show ipv6 interface brief','Check link state and IPv6 addresses.',s=>lines(`Gi0/0  [${s.ipv6Up?'up/up':'administratively down/down'}]`,`    ${field(s,'link6')}`,`    ${field(s,'global6')}`)),
      show(r,'show ipv6 route','The lower-distance route wins for equal prefixes.',s=>lines(...(s.ipv6Up&&s.global6?['C   2001:DB8:12::/64 via Gi0/0']:[]),...routes6.filter(([args,prefix,ad])=>s['v6:'+args]&&!(ad===200&&s['v6:'+routes6[1][0]])).map(([args,prefix,ad])=>`S   ${prefix} [${ad}/0] via ${args.split(' ')[1]}`))),
      show(r,'ping ipv6 2001:db8:12::2','Test the adjacent IPv6 neighbor in the lab.',s=>s.ipv6Up&&s.global6?'!!!!!\nSuccess rate is 100 percent (5/5)':'.....\nSuccess rate is 0 percent (0/5)')
    ]
  },
  {
    id:'ospf',domain:3,title:'Single-area OSPF',objectives:'3.4.a–d',source:'Vol. 1 · Ch. 19–21',
    devices:[r,r2],topology:['R1 · 10.0.12.1','Area 0','R2 · 10.0.12.2'],task:'Form an OSPFv2 adjacency on a broadcast link, compare DR/BDR with point-to-point, then break and restore the link.',
    initial:{},steps:[
      enable(r),config(r),[r,'router ospf 10','Start the local OSPF process. Process IDs can differ between neighbors.'],
      [r,'router-id 1.1.1.1','Set a unique router ID.',set('rid1','1.1.1.1')],[r,'network 10.0.12.0 0.0.0.3 area 0','Enable OSPF on the transit subnet in area 0.',set('net1',true)],
      [r,'network 10.1.1.1 0.0.0.0 area 0','Advertise R1’s loopback.',set('lo1',true)],[r,'passive-interface Loopback0','Advertise its prefix without forming adjacencies there.',set('passive',true)],end(r),
      enable(r2),config(r2),[r2,'router ospf 20','Enter OSPF configuration on R2.'],[r2,'router-id 2.2.2.2','Give R2 a distinct router ID.',set('rid2','2.2.2.2')],
      [r2,'network 10.0.12.0 0.0.0.3 area 0','Match the transit link’s area and enable OSPF on R2.',set('net2',true)],[r2,'network 10.2.2.2 0.0.0.0 area 0','Advertise the remote loopback.',set('lo2',true)],end(r2),
      [r,'show ip ospf neighbor','Verify FULL adjacency. In the lab, R1 was already elected DR before R2 joined.',(s,d)=>ospfNeighbors(s,d)],
      show(r,'show ip ospf database','Inspect area 0 router and network LSAs.',s=>lines('                Router Link States (Area 0)', ...([s.rid1,ospfReady(s)?s.rid2:null].filter(Boolean)), ...(ospfReady(s)&&!s.p2p1?['                Net Link States (Area 0)','10.0.12.1  Adv Router 1.1.1.1']:[]))),
      show(r,'show ip route ospf','Check if the remote loopback was learned.',s=>ospfReady(s)&&s.lo2?'O 10.2.2.2/32 [110/2] via 10.0.12.2, GigabitEthernet0/0':'No OSPF routes.'),
      show(r,'show ip protocols','Confirm process, router ID, distance and passive interface.',s=>lines('Routing Protocol is "ospf 10"',`  Router ID ${field(s,'rid1')}`,`  Passive Interface(s): ${s.passive?'Loopback0':'none'}`,'  Distance: (default is 110)')),
      config(r),port(r,'GigabitEthernet0/0'),[r,'ip ospf network point-to-point','Change the network type on R1.',set('p2p1',true)],end(r),
      config(r2),port(r2,'GigabitEthernet0/0'),[r2,'ip ospf network point-to-point','Match the network type on R2.',set('p2p2',true)],end(r2),
      show(r,'show ip ospf interface GigabitEthernet0/0','Read network type and whether DR/BDR election applies.',s=>lines(`Network Type ${s.p2p1?'POINT_TO_POINT':'BROADCAST'}, Cost: 1`,s.p2p1?'No DR/BDR election':'DR: 1.1.1.1 · BDR: 2.2.2.2',`Neighbor Count ${ospfReady(s)?1:0}`)),
      [r,'show ip ospf neighbor','Confirm the point-to-point neighbor now shows FULL/-.',(s,d)=>ospfNeighbors(s,d)],
      config(r),port(r,'GigabitEthernet0/0'),[r,'shutdown','Disable the transit link and remove the adjacency.',set('ospfShutdown',true)],end(r),
      [r,'show ip ospf neighbor','Verify the adjacency is gone.',(s,d)=>ospfNeighbors(s,d)],
      config(r),port(r,'GigabitEthernet0/0'),[r,'ip ospf 10 area 0','Enable the same process and area directly on the interface.',set('net1',true)],
      [r,'no shutdown','Restore the transit link.',set('ospfShutdown',false)],end(r),
      [r,'show ip ospf neighbor','Confirm the adjacency is back.',(s,d)=>ospfNeighbors(s,d)]
    ]
  }
];
