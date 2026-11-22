import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandHelp, execute, prompt, terminalSession } from '../src/features/labsim/cli.js';
import { addDevice, addLink, branchLab, emptyLab, endpoint, models, removeDevice, restoreLab } from '../src/features/labsim/network.js';

function terminal(lab, device) {
  const session = terminalSession(device);
  return (...commands) => commands.map(command => execute(lab, device, session, command).text).at(-1);
}

function cable(lab, a, portA, b, portB) {
  addLink(lab, endpoint(a, portA), endpoint(b, portB));
}

test('each device type has ten slots and Ethernet ports accept one cable', () => {
  const lab = emptyLab();
  for (const type of Object.keys(models)) {
    for (let i = 0; i < 10; i++) addDevice(lab, type);
    assert.throws(() => addDevice(lab, type), /Limit reached/);
  }
  assert.equal(lab.devices.length,80);
  const first = lab.devices[0];
  const sw = lab.devices[10];
  cable(lab, first, 'Gi0/0', sw, 'Gi0/1');
  assert.throws(() => cable(lab, lab.devices[1], 'Gi0/0', sw, 'Gi0/1'), /already has a cable/);
  removeDevice(lab, first.id);
  const replacement = addDevice(lab, first.type);
  assert.equal(replacement.slot, first.slot);
  assert.notEqual(replacement.id, first.id);
  assert.equal(lab.links.length, 0);
});

test('inter-VLAN traffic reacts to port shutdown and trunk VLAN changes', () => {
  const lab = branchLab();
  const [, sw, pc] = lab.devices;
  const cli = terminal(lab, sw);
  const ping = terminal(lab, pc);
  const command = 'ping 192.168.20.21';
  assert.match(ping(command), /100 percent.*\nPath: PC1 → SW1 → R1 → SW1 → TEL1/);
  cli('enable', 'configure terminal', 'INTERFACE gi0/3', 'shutdown');
  assert.match(ping(command), /0 percent/);
  cli('no shutdown');
  assert.match(ping(command), /100 percent/);
  cli('exit', 'interface gi0/1', 'switchport trunk allowed vlan remove 20');
  assert.match(ping(command), /0 percent/);
  cli('switchport trunk allowed vlan add 20', 'end');
  assert.match(cli('show interfaces trunk'), /10,20/);
  assert.match(ping(command), /100 percent/);
});

test('Wi-Fi association checks the key and DHCP uses the bridged wired VLAN', () => {
  const lab = branchLab();
  const ap = lab.devices.find(device => device.type === 'ap');
  const laptop = addDevice(lab, 'pc');
  const cli = terminal(lab, laptop);
  assert.match(cli('wifi scan'), /Netra-Staff.*WPA2-PSK/);
  assert.match(cli('wifi join Netra-Staff wrong'), /Association failed/);
  assert.match(cli('ipconfig /renew'), /No DHCP offer/);
  assert.match(cli('wifi join Netra-Staff NetraLab26'), /Associated/);
  assert.match(cli('ipconfig /renew'), /192\.168\.10\.22 from R1/);
  assert.match(cli('ping 192.168.10.1'), /100 percent.*\nPath: PC2 → AP1 → SW1 → R1/);
  terminal(lab, ap)('radio off');
  assert.match(cli('ping 192.168.10.1'), /0 percent/);
});

test('static routes require IPv4 reachability in both directions', () => {
  const lab = emptyLab();
  const [r1, r2, pc1, pc2] = ['router', 'router', 'pc', 'pc'].map(type => addDevice(lab, type));
  cable(lab, pc1, 'Eth0', r1, 'Gi0/0');
  cable(lab, r1, 'Gi0/1', r2, 'Gi0/1');
  cable(lab, r2, 'Gi0/0', pc2, 'Eth0');
  const a = terminal(lab, r1), b = terminal(lab, r2), pc = terminal(lab, pc1);
  const configure = (cli, lan, transit) => cli('en', 'conf t', 'interface Gi0/0', 'ip address '+lan+' 24', 'no shutdown', 'exit', 'interface Gi0/1', 'ip address '+transit+' 30', 'no shutdown', 'exit');
  configure(a, '192.0.2.1', '10.0.0.1');
  configure(b, '198.51.100.1', '10.0.0.2');
  pc('ip address 192.0.2.2 24 192.0.2.1');
  terminal(lab, pc2)('ip address 198.51.100.2 24 198.51.100.1');
  a('ip route 198.51.100.0 24 10.0.0.2');
  assert.match(pc('ping 198.51.100.2'), /No return path/);
  b('ip route 192.0.2.0 24 10.0.0.1');
  assert.match(pc('ping 198.51.100.2'), /100 percent.*\nPath: PC1 → R1 → R2 → PC2/);
  b('NO IP ROUTE 192.0.2.0 24 10.0.0.1');
  assert.match(pc('ping 198.51.100.2'), /No return path/);
});

test('phones use the voice VLAN and calls depend on network reachability', () => {
  const lab = branchLab();
  const [, sw, , phone] = lab.devices;
  const phone2 = addDevice(lab, 'phone');
  cable(lab, phone2, 'Eth0', sw, 'Gi0/5');
  terminal(lab, sw)('enable', 'conf t', 'interface gi0/5', 'switchport access vlan 10', 'switchport voice vlan 20');
  assert.match(terminal(lab, phone2)('extension 2002', 'ipconfig /renew'), /192\.168\.20\.22/);
  const cli = terminal(lab, phone);
  assert.match(cli('dial 2002'), /Call connected \(simulated\)/);
  removeDevice(lab, phone2.id);
  assert.match(cli('dial 2002'), /No callable extension/);
});

test('saved workspace preserves the running topology and startup config', () => {
  const lab = branchLab();
  const [r] = lab.devices;
  const session = terminalSession(r);
  assert.equal(prompt(r, session), 'R1>');
  terminal(lab, r)('enable', 'copy running-config startup-config');
  const restored = restoreLab(JSON.stringify(lab));
  const [router, , pc] = restored.devices;
  assert.match(terminal(restored, router)('enable', 'show startup-config'), /encapsulation dot1Q 20/);
  assert.match(terminal(restored, pc)('ping 192.168.20.21'), /100 percent/);
  restored.links[0].a.device = 'n99';
  assert.throws(() => restoreLab(JSON.stringify(restored)), /physical Ethernet ports/);
});

test('CLI expansion resolves each unambiguous keyword and never guesses an ambiguous command', () => {
  const lab=branchLab();
  const [r,sw]=lab.devices;
  const router=terminal(lab,r);
  assert.equal(router('en','sh ip int br'),router('show ip interface brief'));
  assert.equal(router('SH IP ROUT'),router('show ip route'));
  assert.equal(router('sh run | inc hostname'),'hostname R1');
  assert.match(router('sh i'),/Ambiguous.*interfaces.*ip/);
  assert.match(router('sh ip int br extra'),/Invalid input/);
  assert.match(router('conf t','int'),/Incomplete/);
  router('int gig 0/0','desc Core-Edge Uplink');
  assert.match(router('do sh run int g0/0'),/description Core-Edge Uplink/);
  assert.match(router('desc?'),/^description$/);
  assert.match(router('ip ?'),/address/);
  assert.match(router('ip ad'),/Incomplete/);
  const session=terminalSession(sw);
  execute(lab,sw,session,'en');
  assert.equal(commandHelp(sw,session,'sh ip int br').completed,'sh ip int brief ');
  assert.equal(commandHelp(sw,session,'sh i').completed,undefined);
  assert.match(execute(lab,sw,session,'sh vlan ?').text,/brief/);
  assert.equal(commandHelp(sw,session,'sh run | inc').completed,'sh run | include ');
});

test('switch interface ranges, native trunks and management SVIs reflect cable state', () => {
  const lab=branchLab();
  const [r,sw,pc]=lab.devices;
  const configure=terminal(lab,sw), host=terminal(lab,pc);
  configure('en','conf t','int ra gi0/5 - 7','sw mo ac','sw ac vl 10','desc Staff Port','exit',
    'int vlan 10','ip add 192.168.10.11 24','no sh','end');
  assert.match(configure('sh int desc'),/Gi0\/7.+Staff Port/);
  assert.match(configure('sh ip int br'),/Vlan10 +192\.168\.10\.11 +YES manual +up +up/);
  assert.match(host('ping 192.168.10.11'),/100 percent/);
  assert.match(configure('sh mac address-table dynamic vlan 10'),/DYNAMIC.*Gi0\/2/);
  assert.match(terminal(lab,r)('sh cdp nei det'),/SW1/);
  configure('conf t','no cdp run','int gi0/1','sw tr n vl 10','end');
  assert.match(terminal(lab,r)('sh cdp nei'),/No neighbors/);
  assert.match(host('ping 192.168.10.1'),/0 percent/);
  terminal(lab,r)('en','conf t','int gi0/0.10','enc dot1q 10 nat');
  assert.match(host('ping 192.168.10.1'),/100 percent/);
});

test('OSPF learns and withdraws a usable route after an adjacency mismatch', () => {
  const lab=emptyLab();
  const [r1,r2]=['router','router'].map(type=>addDevice(lab,type));
  cable(lab,r1,'Gi0/0',r2,'Gi0/0');
  const a=terminal(lab,r1),b=terminal(lab,r2);
  for(const [cli,number] of [[a,1],[b,2]]){
    cli('en','conf t','int g0/0',`ip add 10.0.0.${number} 30`,'no shut','exit',
      'int lo0',`ip add 192.0.2.${number} 32`,'exit','router ospf '+number,`router-id 192.0.2.${number}`,
      'network 10.0.0.0 0.0.0.3 area 0',`network 192.0.2.${number} 0.0.0.0 area 0`,'end');
  }
  assert.match(a('sh ip ospf nei'),/192\.0\.2\.2.+FULL/);
  assert.match(a('sh ip route ospf'),/O +192\.0\.2\.2\/32/);
  assert.match(a('ping 192.0.2.2'),/100 percent/);
  b('conf t','int g0/0','ip ospf hello-interval 5');
  assert.match(a('sh ip ospf nei'),/No FULL adjacencies/);
  assert.match(a('ping 192.0.2.2'),/0 percent/);
});

test('IPv6 static routes use forwarding state and display neighbor discovery', () => {
  const lab=emptyLab();
  const [r1,r2,r3]=[1,2,3].map(()=>addDevice(lab,'router'));
  cable(lab,r1,'Gi0/0',r2,'Gi0/0');cable(lab,r2,'Gi0/1',r3,'Gi0/0');
  const a=terminal(lab,r1),b=terminal(lab,r2),c=terminal(lab,r3);
  a('en','conf t','int g0/0','ipv6 add 2001:db8:1::1/64','no sh','exit','ipv6 route 2001:db8:2::/64 2001:db8:1::2','end');
  b('en','conf t','int g0/0','ipv6 add 2001:db8:1::2/64','no sh','exit','int g0/1','ipv6 add 2001:db8:2::1/64','no sh','end');
  c('en','conf t','int g0/0','ipv6 add 2001:db8:2::3/64','no sh','exit','ipv6 route 2001:db8:1::/64 2001:db8:2::1','end');
  assert.match(a('ping 2001:DB8:2::3'),/0 percent/);
  b('conf t','ipv6 unicast-routing','end');
  assert.match(a('ping 2001:DB8:2::3'),/100 percent/);
  assert.match(a('sh ipv6 neigh'),/2001:db8:1::2  REACH  Gi0\/0/);
});

test('extended ACL rules are ordered and counted on the live IPv4 path', () => {
  const lab=branchLab();
  const [r,,pc]=lab.devices;
  const a=terminal(lab,r),host=terminal(lab,pc);
  a('en','conf t','ip access-list extended STAFF-IN','10 deny icmp host 192.168.10.21 any echo',
    '20 permit ip any any','exit','int g0/0.10','ip access-group STAFF-IN in','end');
  assert.match(host('ping 192.168.20.21'),/inbound access list denied ICMP/);
  assert.match(a('sh access-lists STAFF-IN'),/10 deny.+\(1 matches\)/);
  a('conf t','ip access-list extended STAFF-IN','no 10','end');
  assert.match(host('ping 192.168.20.21'),/100 percent/);
});

test('PAT creates a return translation for the session across an outside subnet', () => {
  const lab=emptyLab();
  const [r,inside,outside]=['router','pc','pc'].map(type=>addDevice(lab,type));
  cable(lab,r,'Gi0/0',inside,'Eth0');cable(lab,r,'Gi0/1',outside,'Eth0');
  const a=terminal(lab,r),client=terminal(lab,inside);
  client('ip address 10.0.0.2 24 10.0.0.1');
  terminal(lab,outside)('ip address 203.0.113.2 24');
  a('en','conf t','int g0/0','ip add 10.0.0.1 24','ip nat inside','no sh','exit',
    'int g0/1','ip add 203.0.113.1 24','ip nat outside','no sh','end');
  assert.match(client('ping 203.0.113.2'),/No return path/);
  a('conf t','access-list 1 permit 10.0.0.0 0.0.0.255',
    'ip nat inside source list 1 interface gi0/1 overload','end');
  assert.match(client('ping 203.0.113.2'),/100 percent/);
  assert.match(a('sh ip nat tr'),/icmp +203\.0\.113\.1:1 +10\.0\.0\.2/);
  a('clear ip nat translation *');
  assert.match(a('sh ip nat tr'),/No NAT translations/);
});

test('AP channel, hidden SSID, uplink and association settings update the lab', () => {
  const lab=branchLab();
  const [r,sw,, ,ap]=lab.devices;
  const config=terminal(lab,ap);
  const laptop=addDevice(lab,'pc'),client=terminal(lab,laptop);
  assert.match(config('ra b 5','ra ch 36','sho wi ra'),/5 GHz.*Channel 36/);
  assert.match(config('radio channel 6'),/Channels for this band/);
  config('ssi "Campus East"','sec wpa2 MyNewPass','ssi br off');
  assert.match(client('wifi sca'),/No SSIDs visible/);
  assert.match(client('wi j "Campus East" MyNewPass'),/Associated/);
  config('ssid vlan 10');
  assert.match(client('ipconfig /renew'),/No DHCP offer/);
  terminal(lab,sw)('en','conf t','int gi0/4','sw mo tr','sw tr al vl 10');
  assert.match(client('ipconfig /renew'),/192\.168\.10\.22/);
  assert.match(config('sho wi cl'),/PC2.*192\.168\.10\.22/);
  config('shutdown');
  assert.match(client('ping 192.168.10.1'),/0 percent/);
  assert.equal(r.name,'R1');
});

test('switching blocks redundant STP paths and supports negotiated EtherChannel', () => {
  const lab=emptyLab();
  const [s1,s2,s3]=[1,2,3].map(()=>addDevice(lab,'switch'));
  cable(lab,s1,'Gi0/1',s2,'Gi0/1'); cable(lab,s2,'Gi0/2',s3,'Gi0/1'); cable(lab,s3,'Gi0/2',s1,'Gi0/2');
  const a=terminal(lab,s1),b=terminal(lab,s2),c=terminal(lab,s3);
  assert.match(c('sh spa vlan 1'),/Gi0\/1 +Altn +BLK/);
  c('en','conf t','span vlan 1 root primary','end');
  assert.match(a('sh spa vlan 1'),/Root: SW3/);
  cable(lab,s1,'Gi0/3',s2,'Gi0/3');
  a('en','conf t','int ra gi0/1,gi0/3','channel-group 1 mode active','end');
  b('en','conf t','int ra gi0/1,gi0/3','channel-group 2 mode passive','end');
  assert.equal(a('sh ether su').match(/bundled/g)?.length,2);
  b('conf t','int gi0/3','shutdown','end');
  assert.equal(a('sh ether su').match(/bundled/g)?.length,1);
});

test('DHCP snooping learns bindings only through a trusted uplink and DAI uses them', () => {
  const lab=branchLab();
  const [,sw,pc]=lab.devices;
  const cli=terminal(lab,sw),client=terminal(lab,pc);
  cli('en','conf t','ip dhcp snooping','ip dhcp snooping vlan 10','ip arp inspection vlan 10','end');
  assert.match(client('ipconfig /renew'),/No DHCP offer/);
  assert.match(cli('sh ip dhcp snoop stat'),/Dropped DHCP offers: 1/);
  cli('conf t','int g0/1','ip dhcp snooping trust','ip arp inspection trust','end');
  assert.match(client('ipconfig /renew'),/192\.168\.10\.21/);
  assert.match(cli('sh ip dhcp snoop bind'),/PC1 +192\.168\.10\.21 +VLAN 10 +Gi0\/2/);
  assert.match(client('ping 192.168.10.1'),/100 percent/);
  client('ip address 192.168.10.50 24 192.168.10.1');
  assert.match(client('ping 192.168.10.1'),/0 percent/);
  assert.match(cli('sh ip arp insp stat'),/Dropped ARP checks: 1/);
});

test('a multilayer switch routes between an active SVI and a routed port', () => {
  const lab=emptyLab();
  const [sw,pc1,pc2]=['switch','pc','pc'].map(type=>addDevice(lab,type));
  cable(lab,pc1,'Eth0',sw,'Gi0/1');cable(lab,pc2,'Eth0',sw,'Gi0/2');
  const cli=terminal(lab,sw),host=terminal(lab,pc1);
  cli('en','conf t','vlan 10','exit','int g0/1','sw acc vl 10','exit','int vlan 10','ip add 192.0.2.1 24','no sh','exit',
    'int g0/2','no switchport','ip add 198.51.100.1 24','end');
  host('ip address 192.0.2.2 24 192.0.2.1');
  terminal(lab,pc2)('ip address 198.51.100.2 24 198.51.100.1');
  assert.match(host('ping 198.51.100.2'),/0 percent/);
  cli('conf t','ip routing','end');
  assert.match(host('ping 198.51.100.2'),/100 percent/);
  assert.match(cli('sh ip route'),/198\.51\.100\.0\/24.*Gi0\/2/);
});

test('phone passthrough carries untagged PC traffic alongside the voice VLAN', () => {
  const saved = branchLab();
  delete saved.devices[3].ports.Eth1;
  const lab = restoreLab(JSON.stringify(saved));
  const phone = lab.devices[3];
  const pc = addDevice(lab, 'pc');
  cable(lab, phone, 'Eth1', pc, 'Eth0');
  const workstation = terminal(lab, pc);
  const handset = terminal(lab, phone);
  assert.match(workstation('ipconfig /renew'), /192\.168\.10\./);
  assert.match(handset('ipconfig /renew'), /192\.168\.20\./);
  assert.match(workstation('ping 192.168.10.1'), /PC2 → TEL1 → SW1.*R1/);
  terminal(lab, lab.devices[1])('en', 'conf t', 'int gi0/3', 'no switchport voice vlan');
  assert.match(handset('ipconfig /renew'), /192\.168\.10\./);
  assert.match(workstation('ipconfig /renew'), /192\.168\.10\./);
});
