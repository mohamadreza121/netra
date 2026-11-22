import assert from 'node:assert/strict';
import test from 'node:test';
import { addDevice, addLink, emptyLab, endpoint, restoreLab } from '../src/features/labsim/network.js';
import { execute, prompt, terminalSession } from '../src/features/labsim/cli.js';
import { buildCommandIndex } from '../src/features/labsim/command-index.js';
import { practiceUrl } from '../src/features/labsim/practice-url.js';

const cable=(lab,a,x,b,y)=>addLink(lab,endpoint(a,x),endpoint(b,y));
function consoleFor(lab,d) {
  const session=terminalSession(d);
  const run=command=>execute(lab,d,session,command).text;
  const config=(...commands)=>{
    if(session.mode==='user')assert.doesNotMatch(run('enable'),/^%/);
    if(session.mode==='exec')assert.doesNotMatch(run('configure terminal'),/^%/);
    for(const command of [...commands,'end']){
      const result=run(command);
      assert.doesNotMatch(result,/^%/,d.name+' '+command+' → '+result);
    }
  };
  return {run,config};
}

test('flash archives, startup restore and reload preserve the configured device and its cables',()=>{
  let lab=emptyLab(),device=addDevice(lab,'router'),server=addDevice(lab,'server');
  cable(lab,device,'Gi0/0',server,'Eth0');
  let router=consoleFor(lab,device);
  consoleFor(lab,server).run('ip address 192.0.2.2 24');
  router.config('int gi0/0','ip address 192.0.2.1 255.255.255.0','no shut','exit',
    'archive','path flash:edge','maximum 2','write-memory');
  assert.match(router.run('write memory'),/\[OK\]/);
  assert.match(router.run('archive config'),/edge-2\.cfg/);
  assert.match(router.run('archive config'),/edge-3\.cfg/);
  assert.doesNotMatch(router.run('show archive'),/edge-1/);
  assert.match(router.run('dir flash:'),/edge-2\.cfg.*\n.*edge-3\.cfg/);
  assert.match(router.run('dir nvram:'),/startup-config/);
  router.config('int gi0/0','shutdown');
  assert.match(router.run('ping 192.0.2.2'),/0 percent/);
  lab=restoreLab(JSON.stringify(lab));device=lab.devices[0];router=consoleFor(lab,device);
  router.run('enable');
  assert.match(router.run('configure replace flash:edge-3.cfg force'),/replaced/);
  assert.match(router.run('ping 192.0.2.2'),/100 percent/);
  router.config('int gi0/0','shutdown','exit','interface loopback42','ip address 198.51.100.42 255.255.255.255');
  assert.match(router.run('copy startup-config running-config'),/applied/);
  assert.match(router.run('ping 192.0.2.2'),/100 percent/);
  assert.match(router.run('show ip int br'),/Lo42.*198.51.100.42/);
  assert.match(router.run('reload'),/restarted/);
  assert.doesNotMatch(router.run('show ip int br'),/Lo42/);
  assert.match(router.run('ping 192.0.2.2'),/100 percent/);
});

test('TFTP restores configurations transactionally and requires a reachable server',()=>{
  const lab=emptyLab(),device=addDevice(lab,'router'),server=addDevice(lab,'server');
  cable(lab,device,'Gi0/0',server,'Eth0');
  const router=consoleFor(lab,device),files=consoleFor(lab,server);
  files.run('ip address 192.0.2.2 24');
  router.config('int Gi0/0','ip address 192.0.2.1 255.255.255.0','no shut','description Original','exit',
    'ip tftp source-interface GigabitEthernet0/0');
  assert.match(router.run('copy running-config tftp://192.0.2.2/edge.cfg'),/^%/);
  files.run('service tftp on');
  assert.match(router.run('copy running-config tftp://192.0.2.2/edge.cfg'),/File written/);
  assert.match(files.run('show tftp files'),/edge\.cfg/);
  router.config('int Gi0/0','description Changed');
  assert.match(router.run('copy tftp://192.0.2.2/edge.cfg running-config'),/applied/);
  assert.match(router.run('show run interface Gi0/0'),/description Original/);
  server.files['patch.cfg']='interface Gi0/0\n description Broken\n nonexistent command\n';
  assert.match(router.run('copy tftp://192.0.2.2/patch.cfg running-config'),/^% .*failed/);
  assert.match(router.run('show run interface Gi0/0'),/description Original/);
  files.run('tftp file edge.cfg "hostname UPDATED"');
  assert.match(router.run('copy tftp://192.0.2.2/edge.cfg running-config'),/applied/);
  assert.equal(device.name,'UPDATED');
});

test('enable secret changes access to privileged EXEC and device time uses the configured zone',()=>{
  const lab=emptyLab(),device=addDevice(lab,'router'),session=terminalSession(device);
  const run=command=>execute(lab,device,session,command).text;
  for(const command of ['en','conf t','enable secret MyLabPass','clock timezone NDT -2 30','end',
    'clock set 14:20:06 10 June 2026']){
    assert.doesNotMatch(run(command),/^%/,command);
  }
  assert.match(run('show clock detail'),/2026-06-10 14:20:0[67].* NDT/);
  assert.match(run('show running-config'),/enable secret \[configured\]/);
  assert.doesNotMatch(run('show history'),/MyLabPass/);
  run('disable');run('en');
  assert.equal(prompt(device,session),'Password:');
  assert.match(run('Wrong'),/denied/);
  assert.equal(session.mode,'user');
  run('en');run('MyLabPass');
  assert.equal(session.mode,'exec');
});

test('DTP negotiates the trunk and matching VTP domain advertises VLANs to a client',()=>{
  const lab=emptyLab(),a=addDevice(lab,'switch'),b=addDevice(lab,'switch'),first=addDevice(lab,'pc'),last=addDevice(lab,'pc');
  cable(lab,a,'Gi0/1',b,'Gi0/1');cable(lab,a,'Gi0/2',first,'Eth0');cable(lab,b,'Gi0/2',last,'Eth0');
  const server=consoleFor(lab,a),client=consoleFor(lab,b),pc=consoleFor(lab,first),other=consoleFor(lab,last);
  server.config('vtp domain CAMPUS','vtp version 2','vtp password NetraSwitch',
    'vlan 72','name STAFF','exit','int gi0/1','switchport mode dynamic auto','exit','int gi0/2','switchport access vlan 72');
  client.config('vtp domain CAMPUS','vtp version 2','vtp password NetraSwitch','vtp mode client','int gi0/1','switchport mode dynamic auto',
    'exit','int gi0/2','switchport access vlan 72');
  pc.run('ip address 10.72.0.1 24');other.run('ip address 10.72.0.2 24');
  assert.match(client.run('show dtp interface gi0/1'),/auto.*Operational access/);
  assert.doesNotMatch(client.run('show vlan brief'),/STAFF/);
  assert.match(pc.run('ping 10.72.0.2'),/0 percent/);
  server.config('int gi0/1','switchport mode dynamic desirable');
  assert.match(client.run('show dtp interface gi0/1'),/auto.*Operational trunk/);
  assert.match(client.run('show vlan brief'),/72\s+STAFF/);
  assert.match(pc.run('ping 10.72.0.2'),/100 percent/);
  server.config('no vlan 72');
  assert.doesNotMatch(client.run('show vlan brief'),/STAFF/);
  assert.match(pc.run('ping 10.72.0.2'),/0 percent/);
});

test('older workspaces gain the full switch port count and port 24 works as a trusted trunk',()=>{
  const original=emptyLab(),old=addDevice(original,'switch');
  for(const name of Object.keys(old.ports).slice(8))delete old.ports[name];
  const lab=restoreLab(JSON.stringify(original)),west=lab.devices[0],east=addDevice(lab,'switch');
  cable(lab,west,'Gi0/24',east,'Gi0/24');
  const cli=consoleFor(lab,west),peer=consoleFor(lab,east);
  assert.equal(Object.keys(west.ports).length,24);
  cli.config('int GigabitEthernet0/24','switchport mode trunk','ip arp inspection trust');
  peer.config('int GigabitEthernet0/24','switchport mode trunk');
  assert.match(cli.run('show interfaces trunk'),/Gi0\/24.*trunking/);
  assert.match(cli.run('show ip arp inspection interfaces GigabitEthernet0/24'),/Gi0\/24.*Trusted.*up/);
});

test('routed LACP port-channels carry IP and withdraw routes below min-links',()=>{
  const lab=emptyLab(),a=addDevice(lab,'switch'),b=addDevice(lab,'switch');
  cable(lab,a,'Gi0/1',b,'Gi0/1');cable(lab,a,'Gi0/2',b,'Gi0/2');
  const west=consoleFor(lab,a),east=consoleFor(lab,b);
  for(const [cli,mode,ip] of [[west,'active','192.0.2.1'],[east,'passive','192.0.2.2']]){
    cli.config('ip routing','int range gi0/1 - 2','no switchport','channel-group 21 mode '+mode,'exit',
      'int port-channel21','port-channel min-links 2','ip address '+ip+' 255.255.255.252');
  }
  assert.match(west.run('show lacp neighbor'),/Partner SW2/);
  assert.match(west.run('show etherchannel 21 detail'),/Po21 is up · Layer 3/);
  assert.match(west.run('ping 192.0.2.2'),/100 percent/);
  east.config('int gi0/2','shutdown');
  assert.match(west.run('show etherchannel 21 detail'),/Po21 is down/);
  assert.match(west.run('ping 192.0.2.2'),/0 percent/);
  east.config('int gi0/2','no shutdown');
  assert.match(west.run('ping 192.0.2.2'),/100 percent/);
});

test('MST regions control per-instance roots and root guard blocks the superior link',()=>{
  const lab=emptyLab(),a=addDevice(lab,'switch'),b=addDevice(lab,'switch'),pc=addDevice(lab,'pc'),peer=addDevice(lab,'pc');
  cable(lab,a,'Gi0/1',b,'Gi0/1');cable(lab,a,'Gi0/2',pc,'Eth0');cable(lab,b,'Gi0/2',peer,'Eth0');
  const west=consoleFor(lab,a),east=consoleFor(lab,b),client=consoleFor(lab,pc),other=consoleFor(lab,peer);
  for(const cli of [west,east])cli.config('vlan 72','exit','vlan 84','exit','spanning-tree mode mst','spanning-tree mst configuration',
    'name CAMPUS','revision 1','instance 1 vlan 72','instance 2 vlan 84','exit','int gi0/1','switchport mode trunk',
    'exit','int gi0/2','switchport access vlan 72');
  west.config('spanning-tree mst 1 priority 4096');
  east.config('spanning-tree mst 2 priority 4096');
  assert.match(west.run('show spanning-tree mst 1'),/Root: SW1/);
  assert.match(west.run('show spanning-tree mst 2'),/Root: SW2/);
  assert.match(west.run('show spanning-tree mst interface gi0/1'),/Internal/);
  client.run('ip address 10.72.0.1 24');other.run('ip address 10.72.0.2 24');
  assert.match(client.run('ping 10.72.0.2'),/100 percent/);
  east.config('int gi0/1','spanning-tree guard root');
  assert.match(east.run('show spanning-tree inconsistentports'),/72.*root-inconsistent/);
  assert.match(client.run('ping 10.72.0.2'),/0 percent/);
});

test('IPv6 eBGP exchanges independent prefixes and withdraws when the IPv6 AF is disabled',()=>{
  const lab=emptyLab(),a=addDevice(lab,'router'),b=addDevice(lab,'router');
  cable(lab,a,'Gi0/0',b,'Gi0/0');
  const west=consoleFor(lab,a),east=consoleFor(lab,b);
  for(const [cli,as,remote,local,neighbor,loop] of [
    [west,65024,4200000042,'2001:db8:24::1','2001:db8:24::2','2001:db8:2400::1'],
    [east,4200000042,65024,'2001:db8:24::2','2001:db8:24::1','2001:db8:2600::1']]){
    cli.config('ipv6 unicast-routing','int gi0/0','ipv6 address '+local+'/64','no shutdown','exit','int loopback0',
      'ipv6 address '+loop+'/128','exit','router bgp '+as,'no bgp default ipv4-unicast','neighbor '+neighbor+' remote-as '+remote,
      'address-family ipv6 unicast','neighbor '+neighbor+' activate','network '+loop+'/128');
  }
  assert.match(west.run('show bgp ipv6 unicast summary'),/Established \/ 1/);
  assert.match(west.run('show ipv6 route bgp'),/2001:db8:2600::1\/128.*via 2001:db8:24::2/);
  assert.match(west.run('ping ipv6 2001:db8:2600::1 source lo0'),/100 percent/);
  east.config('router bgp 4200000042','address-family ipv6 unicast','no neighbor 2001:db8:24::1 activate');
  assert.match(west.run('show bgp ipv6 unicast summary'),/Idle/);
  assert.match(west.run('ping ipv6 2001:db8:2600::1'),/0 percent/);
});

test('OSPFv3 carries both families and a mismatched authentication key withdraws the routes',()=>{
  const lab=emptyLab(),a=addDevice(lab,'router'),b=addDevice(lab,'router');
  cable(lab,a,'Gi0/0',b,'Gi0/0');
  const west=consoleFor(lab,a),east=consoleFor(lab,b);
  for(const [cli,h] of [[west,1],[east,2]]){
    cli.config('ipv6 unicast-routing','router ospfv3 76','router-id 10.76.0.'+h,'exit',
      'key chain OSPFV3','key 12','key-string NetraRouting','cryptographic-algorithm hmac-sha-256','exit','exit',
      'int gi0/0','ip address 192.0.2.'+h+' 255.255.255.252','ipv6 enable','no shutdown','ospfv3 76 ipv4 area 0','ospfv3 76 ipv6 area 0',
      'ospfv3 network point-to-point','ospfv3 authentication key-chain OSPFV3','exit','int lo0','ip address 10.76.0.'+h+' 255.255.255.255',
      'ipv6 address 2001:db8:76::'+h+'/128','ospfv3 76 ipv4 area 0','ospfv3 76 ipv6 area 0');
  }
  assert.match(west.run('show ospfv3 neighbor'),/ipv6.*FULL/);
  assert.match(west.run('show ip route ospf'),/10\.76\.0\.2\/32/);
  assert.match(west.run('show ipv6 route ospf'),/2001:db8:76::2\/128.*via fe80::/);
  assert.match(west.run('ping ipv6 2001:db8:76::2'),/100 percent/);
  east.config('key chain OSPFV3','key 12','key-string Different');
  assert.match(west.run('show ospfv3 neighbor'),/No FULL/);
  assert.match(west.run('ping ipv6 2001:db8:76::2'),/0 percent/);
});

test('IPv6 VRFs keep identical prefixes separate and preserve scoped next hops through save and restore',()=>{
  const lab=emptyLab(),r=addDevice(lab,'router'),a=addDevice(lab,'router'),b=addDevice(lab,'router');
  cable(lab,r,'Gi0/0',a,'Gi0/0');cable(lab,r,'Gi0/1',b,'Gi0/0');
  const edge=consoleFor(lab,r);
  edge.config('ipv6 unicast-routing','vrf definition RED','address-family ipv6','exit','exit','vrf definition BLUE','address-family ipv6','exit','exit',
    'int gi0/0','vrf forwarding RED','ipv6 address 2001:db8:90::1/64','no shutdown','exit','int gi0/1','vrf forwarding BLUE','ipv6 address 2001:db8:90::1/64',
    'no shutdown','exit','ipv6 route vrf RED 2001:db8:91::/64 gi0/0 fe80::2','ipv6 route vrf BLUE 2001:db8:91::/64 gi0/1 fe80::2');
  for(const node of [a,b])consoleFor(lab,node).config('ipv6 unicast-routing','int gi0/0','ipv6 address 2001:db8:90::2/64','ipv6 address fe80::2 link-local',
    'no shutdown','exit','int lo0','ipv6 address 2001:db8:91::2/64');
  const restored=restoreLab(JSON.stringify(lab));
  const cli=consoleFor(restored,restored.devices[0]);
  assert.match(cli.run('show ipv6 route vrf RED'),/2001:db8:91::\/64.*[Gg]i0\/0/);
  assert.match(cli.run('ping ipv6 vrf RED 2001:db8:91::2'),/R1 → R2/);
  assert.match(cli.run('ping ipv6 vrf BLUE 2001:db8:91::2'),/R1 → R3/);
  assert.match(cli.run('ping ipv6 2001:db8:91::2'),/0 percent/);
});

test('every indexed course example opens its exact scenario step',()=>{
  const entries=buildCommandIndex();
  assert.ok(entries.length>2000);
  assert.ok(entries.filter(e=>e.labSim).length>1000);
  const v6=entries.find(e=>e.lesson==='ebgp-dual-stack'&&e.command==='address-family ipv6 unicast');
  assert.equal(v6.labSim,true);
  const vpn=entries.find(e=>e.command==='show sdwan control connections');
  assert.equal(vpn.labSim,false);
  for(const entry of entries){
    const url=new URL(practiceUrl(entry), 'https://netra.test/');
    assert.equal(url.searchParams.get('lab'),entry.lesson);
    assert.equal(Number(url.searchParams.get('step')),entry.index);
  }
});

test('MPLS L3VPN imports matching route targets and carries traffic only while the LDP path is available',()=>{
  const lab=emptyLab(),a=addDevice(lab,'router'),core=addDevice(lab,'router'),b=addDevice(lab,'router'),
    first=addDevice(lab,'pc'),last=addDevice(lab,'pc');
  cable(lab,a,'Gi0/0',core,'Gi0/0');cable(lab,b,'Gi0/0',core,'Gi0/1');
  cable(lab,a,'Gi0/1',first,'Eth0');cable(lab,b,'Gi0/1',last,'Eth0');
  const west=consoleFor(lab,a),east=consoleFor(lab,b),p=consoleFor(lab,core);
  p.config('int gi0/0','ip address 192.0.2.2 255.255.255.252','ip ospf 72 area 0','mpls ip','no shutdown','exit',
    'int gi0/1','ip address 198.51.100.1 255.255.255.252','ip ospf 72 area 0','mpls ip','no shutdown');
  for(const [cli,local,remote,underlay,vrf,lan,rd] of [
    [west,'10.80.0.1','10.80.0.3','192.0.2.1','LAB-WEST','203.0.113.1','65080:1'],
    [east,'10.80.0.3','10.80.0.1','198.51.100.2','LAB-EAST','198.18.0.1','65080:2']]){
    cli.config('vrf definition '+vrf,'rd '+rd,'address-family ipv4','route-target both 65080:80','exit','exit',
      'int gi0/0','ip address '+underlay+' 255.255.255.252','ip ospf 72 area 0','mpls ip','no shutdown','exit',
      'int lo0','ip address '+local+' 255.255.255.255','ip ospf 72 area 0','exit','mpls ldp router-id lo0 force',
      'int gi0/1','vrf forwarding '+vrf,'ip address '+lan+' 255.255.255.0','no shutdown','exit',
      'router bgp 65080','no bgp default ipv4-unicast','neighbor '+remote+' remote-as 65080','neighbor '+remote+' update-source lo0',
      'address-family vpnv4','neighbor '+remote+' activate','neighbor '+remote+' send-community extended','exit-address-family',
      'address-family ipv4 vrf '+vrf,'redistribute connected');
  }
  const pc=consoleFor(lab,first);pc.run('ip address 203.0.113.2 24 203.0.113.1');
  consoleFor(lab,last).run('ip address 198.18.0.2 24 198.18.0.1');
  assert.match(west.run('show bgp vpnv4 unicast all summary'),/10\.80\.0\.3.*Established/);
  assert.match(west.run('show mpls ldp neighbor'),/Oper/);
  assert.match(west.run('show bgp vpnv4 unicast all 198.18.0.0/24'),/65080:2.*VPN label/);
  assert.match(west.run('show ip route vrf LAB-WEST'),/198\.18\.0\.0\/24.*via 10\.80\.0\.3/);
  assert.match(pc.run('ping 198.18.0.2'),/PC1 → R1 → R2 → R3 → PC2/);
  p.config('int gi0/1','no mpls ip');
  assert.match(west.run('show bgp vpnv4 unicast all summary'),/Established/);
  assert.doesNotMatch(west.run('show ip route vrf LAB-WEST'),/198\.18\.0\.0/);
  assert.match(pc.run('ping 198.18.0.2'),/0 percent/);
  p.config('int gi0/1','mpls ip');
  east.config('vrf definition LAB-EAST','address-family ipv4','no route-target export 65080:80','route-target export 65080:81');
  assert.doesNotMatch(west.run('show ip route vrf LAB-WEST'),/198\.18\.0\.0/);
});

test('QoS marking feeds downstream classification and policing changes probe results',()=>{
  const lab=emptyLab(),a=addDevice(lab,'router'),b=addDevice(lab,'router'),pc=addDevice(lab,'pc');
  cable(lab,a,'Gi0/0',pc,'Eth0');cable(lab,a,'Gi0/1',b,'Gi0/0');
  const first=consoleFor(lab,a),last=consoleFor(lab,b),host=consoleFor(lab,pc);
  first.config('int gi0/0','ip address 10.72.0.1 255.255.255.0','no shutdown','exit',
    'int gi0/1','ip address 192.0.2.1 255.255.255.252','no shutdown','exit',
    'class-map match-any NEEDS-EF','match dscp af41','exit','policy-map MARK-EF','class NEEDS-EF','set dscp ef','end',
    'configure terminal','int gi0/0','service-policy input MARK-EF');
  last.config('int gi0/0','ip address 192.0.2.2 255.255.255.252','no shutdown','exit',
    'ip route 10.72.0.0 255.255.255.0 192.0.2.1','class-map match-any VOICE','match dscp ef','exit',
    'policy-map LIMIT','class VOICE','police 1344 conform-action transmit exceed-action drop','exit','exit',
    'control-plane','service-policy input LIMIT');
  host.run('ip address 10.72.0.2 24 10.72.0.1');
  assert.match(host.run('ping -Q 136 -c 5 192.0.2.2'),/40 percent \(2\/5\)/);
  assert.match(first.run('show policy-map interface gi0/0'),/Marked 5/);
  assert.match(last.run('show policy-map control-plane'),/Dropped 3/);
  assert.match(host.run('ping -c 5 192.0.2.2'),/100 percent/);
});

test('IPv6 transport ACLs allow selected HTTPS traffic and count denied ICMP while preserving ND',()=>{
  const lab=emptyLab(),router=addDevice(lab,'router'),client=addDevice(lab,'pc'),server=addDevice(lab,'server');
  cable(lab,router,'Gi0/0',client,'Eth0');cable(lab,router,'Gi0/1',server,'Eth0');
  const edge=consoleFor(lab,router),pc=consoleFor(lab,client),srv=consoleFor(lab,server);
  edge.config('ipv6 unicast-routing','int gi0/0','ipv6 address 2001:db8:1::1/64','no shutdown','exit',
    'int gi0/1','ipv6 address 2001:db8:2::1/64','no shutdown','exit',
    'ipv6 access-list EDGE','sequence 10 permit icmp any any nd-ns','sequence 15 permit icmp any any nd-na',
    'sequence 20 permit tcp 2001:db8:1::/64 host 2001:db8:2::2 eq 443','sequence 90 deny ipv6 any any log','exit',
    'int gi0/0','ipv6 traffic-filter EDGE in','ipv6 verify unicast source reachable-via rx');
  pc.run('ipv6 address 2001:db8:1::2/64 2001:db8:1::1');
  srv.run('ipv6 address 2001:db8:2::2/64 2001:db8:2::1');srv.run('service https on');
  assert.match(pc.run('curl -I https://[2001:db8:2::2]'),/200 OK/);
  assert.match(pc.run('ping 2001:db8:2::2'),/input IPv6 ACL denied ICMP/);
  assert.match(edge.run('show ipv6 access-list EDGE'),/sequence 90 .* \(1 matches\)/);
  edge.config('int gi0/0','no ipv6 traffic-filter EDGE in');
  assert.match(pc.run('ping 2001:db8:2::2'),/100 percent/);
});

test('protected DMVPN registers spokes, learns the Phase 3 shortcut and rejects a wrong key',async()=>{
  const { dmvpnLab }=await import('../src/features/labsim/vpn-labs.js');
  const lab=dmvpnLab(),hub=consoleFor(lab,lab.devices[0]),west=consoleFor(lab,lab.devices[1]),east=consoleFor(lab,lab.devices[2]);
  const pc=consoleFor(lab,lab.devices.find(device=>device.name==='PC1'));
  assert.match(hub.run('show dmvpn'),/Total NBMA Peers: 2/);
  assert.match(west.run('show ip route eigrp'),/10\.79\.3\.0\/24.*10\.79\.0\.1/);
  assert.match(west.run('show ip nhrp shortcut'),/No active/);
  assert.match(pc.run('ping 10.79.3.2'),/PC1 → R2 → SW1 → R1 → SW1 → R3 → PC2/);
  assert.match(west.run('show ip nhrp shortcut'),/10\.79\.0\.3 via 192\.0\.2\.3/);
  assert.match(pc.run('ping 10.79.3.2'),/PC1 → R2 → SW1 → R3 → PC2/);
  assert.match(west.run('show crypto ipsec sa'),/#pkts encaps: 5/);
  east.config('crypto ikev2 keyring LAB-RING','peer CLOUD','pre-shared-key WrongLabKey');
  assert.match(east.run('show crypto ikev2 sa'),/No READY/);
  assert.match(hub.run('show dmvpn'),/Total NBMA Peers: 1/);
  assert.match(pc.run('ping 10.79.3.2'),/0 percent/);
});
