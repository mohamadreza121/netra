import assert from 'node:assert/strict';
import test from 'node:test';
import { execute, prompt, terminalSession } from '../src/features/labsim/cli.js';
import { enterpriseLab } from '../src/features/labsim/enterprise-lab.js';
import { addDevice, addLink, emptyLab, endpoint, restoreLab } from '../src/features/labsim/network.js';

function byName(lab,name) {
  const device=lab.devices.find(d=>d.name===name);
  assert.ok(device,'missing '+name);
  return device;
}
function consoleFor(lab,name) {
  const device=byName(lab,name), session=terminalSession(device);
  return {
    run:command=>execute(lab,device,session,command),
    config: (...commands)=>{
      for(const command of [...(session.mode==='user'?['en']:[]),'conf t',...commands,'end']) {
        const result=execute(lab,device,session,command);
        assert.doesNotMatch(result.text,/^%/,name+' '+command+' → '+result.text);
      }
    },
    prompt:()=>prompt(device,session,lab)
  };
}
const cable=(lab,a,port,b,to)=>addLink(lab,endpoint(a,port),endpoint(b,to));

test('controller WLAN uses CAPWAP, ISE and the live campus DHCP relay',()=>{
  const lab=enterpriseLab();
  const wlc=consoleFor(lab,'WLC1'), pc=consoleFor(lab,'PC1'), access=consoleFor(lab,'SW1');
  const ap=consoleFor(lab,'AP1'), ise=consoleFor(lab,'ISE1');
  assert.match(ap.run('show capwap client rcb').text,/RUN · WLC1/);
  assert.match(wlc.run('sh ap sum').text,/AP1.*RUN/);
  assert.match(wlc.run('show ap tag summary').text,/AP1.*CAMPUS/);
  assert.match(pc.run('wifi scan').text,/Netra-Enterprise.*WPA2-Enterprise/);
  assert.match(pc.run('wifi join Netra-Enterprise enterprise denied NetraStudent').text,/denied access/);
  assert.match(ise.run('show radius live-logs').text,/REJECT.*denied/);
  assert.match(pc.run('wifi join Netra-Enterprise enterprise student NetraStudent').text,/Associated/);
  assert.match(pc.run('ipconfig /renew').text,/10\.72\.110\.21 from SRV1/);
  assert.match(pc.run('nslookup provider.netra.test').text,/203\.0\.113\.53/);
  assert.match(pc.run('curl -I http://campus.netra.test/status').text,/HTTP\/1\.1 200/);
  assert.match(pc.run('curl http://campus.netra.test/status').text,/Netra campus services are online/);
  assert.match(wlc.run('show wireless client summary').text,/Netra-Enterprise.*VLAN 110/);
  assert.match(pc.run('ping provider.netra.test').text,/PC1 → AP1 → WLC1 → SW1 → R1 → R2/);

  wlc.config('wlan Staff 10 Netra-Enterprise','no security wpa wpa2 ciphers aes');
  assert.match(pc.run('wifi status').text,/Not associated/);
  wlc.config('wlan Staff 10 Netra-Enterprise','security wpa wpa2 ciphers aes');
  assert.match(pc.run('wifi status').text,/Associated.*Netra-Enterprise/);

  access.config('interface gi0/2','switchport trunk allowed vlan remove 110');
  assert.match(ap.run('show capwap client rcb').text,/RUN/);
  assert.match(pc.run('ipconfig /renew').text,/No DHCP offer/);
  access.config('interface gi0/2','switchport trunk allowed vlan add 110');
  assert.match(pc.run('ipconfig /renew').text,/DHCP lease/);

  wlc.config('wireless profile policy STAFF','no central switching');
  assert.match(pc.run('ipconfig /renew').text,/No DHCP offer/);
  access.config('interface gi0/3','switchport mode trunk','switchport trunk native vlan 100','switchport trunk allowed vlan 100,110');
  assert.match(pc.run('ipconfig /renew').text,/DHCP lease/);
  assert.match(pc.run('ping provider.netra.test').text,/PC1 → AP1 → SW1 → R1 → R2/);
  access.config('interface gi0/3','shutdown');
  assert.match(wlc.run('show ap summary').text,/No joined access points/);
  assert.match(pc.run('wifi status').text,/Not associated/);
});

test('wired 802.1X, SSH authentication, NTP, syslog and SIP depend on service state',()=>{
  const lab=enterpriseLab();
  const pc=consoleFor(lab,'PC2'), access=consoleFor(lab,'SW1'), ise=consoleFor(lab,'ISE1');
  const edge=consoleFor(lab,'R1'), server=consoleFor(lab,'SRV1'), phone=consoleFor(lab,'TEL1');
  assert.match(pc.run('ipconfig /renew').text,/No DHCP offer/);
  assert.match(pc.run('dot1x login student NetraStudent').text,/authorized on VLAN 110/);
  assert.match(access.run('show access-session interface gi0/6').text,/Authorized.*VLAN 110/);
  assert.match(pc.run('ipconfig /renew').text,/DHCP lease/);
  assert.match(pc.run('ssh -l netadmin 10.72.110.1').text,/Password required/);
  assert.equal(pc.prompt(),'Password:');
  assert.match(pc.run('wrong').text,/Permission denied/);
  pc.run('ssh netadmin@10.72.110.1');
  assert.match(pc.run('NetraAdmin').text,/Connected to R1/);
  assert.equal(pc.prompt(),'R1>');
  assert.match(pc.run('sh ip int br').text,/10\.72\.110\.1/);
  pc.run('exit');
  assert.equal(pc.prompt(),'PC2>');
  assert.match(ise.run('show tacacs live-logs').text,/ACCEPT/);
  assert.match(edge.run('show ntp status').text,/stratum 4/);
  edge.run('enable');
  assert.match(edge.run('send log 5 Campus service test').text,/generated/);
  assert.match(server.run('show logging').text,/Campus service test/);
  assert.match(edge.run('copy running-config tftp://10.72.100.30/R1.cfg').text,/File written to SRV1/);
  assert.match(server.run('show tftp files').text,/R1.cfg/);
  assert.match(phone.run('ipconfig /all').text,/Option 150/);
  assert.match(phone.run('dial 2002').text,/200 OK/);
  assert.match(phone.run('hangup').text,/ended/);
  server.run('service sip off');
  assert.match(phone.run('dial 2002').text,/failed/);
  ise.run('application stop ise');
  pc.run('dot1x logout');
  assert.match(pc.run('dot1x login student NetraStudent').text,/denied.*No reachable/);
  assert.match(pc.run('ipconfig /renew').text,/No DHCP offer/);
});

test('BGP installs prefixes with matching RIB routes, filters them, and withdraws them on link failure',()=>{
  const lab=restoreLab(JSON.stringify(enterpriseLab()));
  const edge=consoleFor(lab,'R1'), pc=consoleFor(lab,'PC1'), provider=consoleFor(lab,'R2');
  pc.run('wifi join Netra-Enterprise enterprise student NetraStudent');
  pc.run('ipconfig /renew');
  assert.match(edge.run('sh ip bgp sum').text,/Established \/ 1/);
  assert.match(edge.run('sh ip rout bgp').text,/B\s+203\.0\.113\.53\/32/);
  assert.match(provider.run('show ip bgp neighbors 192.0.2.1 routes').text,/10\.72\.110\.0\/24/);
  edge.config('ip prefix-list PROVIDER seq 5 deny 203.0.113.53/32','ip prefix-list PROVIDER seq 10 permit 0.0.0.0/0 le 32',
    'route-map INBOUND permit 10','match ip address prefix-list PROVIDER','set local-preference 180','exit',
    'router bgp 65001','address-family ipv4 unicast','neighbor 192.0.2.2 route-map INBOUND in');
  assert.match(edge.run('show bgp ipv4 unicast summary').text,/Established \/ 0/);
  assert.match(edge.run('sh ip route bgp').text,/No active routes/);
  assert.match(pc.run('ping 203.0.113.53').text,/0 percent/);
  edge.config('ip prefix-list PROVIDER seq 5 permit 203.0.113.53/32');
  assert.match(edge.run('sh ip bgp').text,/203\.0\.113\.53\/32.*180/);
  assert.match(pc.run('ping 203.0.113.53').text,/100 percent/);
  edge.config('int gi0/1','shutdown');
  assert.doesNotMatch(edge.run('show ip bgp sum').text,/Established/);
  assert.match(pc.run('ping 203.0.113.53').text,/0 percent/);
});

test('EIGRP named and classic processes interoperate and withdraw when authenticators differ',()=>{
  const lab=emptyLab(), a=addDevice(lab,'router'), b=addDevice(lab,'router');
  cable(lab,a,'Gi0/0',b,'Gi0/0');
  const first=consoleFor(lab,'R1'), second=consoleFor(lab,'R2');
  first.config('key chain CAMPUS','key 1','key-string NetraLink','exit','exit',
    'int gi0/0','ip address 10.0.0.1 255.255.255.252','no shut','ip authentication mode eigrp 77 md5','ip authentication key-chain eigrp 77 CAMPUS','exit',
    'int lo0','ip address 10.1.1.1 255.255.255.255','exit',
    'router eigrp 77','network 10.0.0.0 0.0.0.3','network 10.1.1.1 0.0.0.0');
  second.config('key chain CAMPUS','key 1','key-string NetraLink','exit','exit',
    'int gi0/0','ip address 10.0.0.2 255.255.255.252','no shut','exit',
    'int lo0','ip address 10.2.2.2 255.255.255.255','exit',
    'router eigrp CAMPUS','address-family ipv4 unicast autonomous-system 77','network 10.0.0.0 0.0.0.3','network 10.2.2.2 0.0.0.0',
    'af-interface gi0/0','authentication mode md5','authentication key-chain CAMPUS','exit-af-interface','exit-address-family');
  assert.match(first.run('sh ip eigrp nei').text,/10\.0\.0\.2.*R2/);
  assert.match(first.run('sh ip route eigrp').text,/D\s+10\.2\.2\.2\/32/);
  assert.match(first.run('ping 10.2.2.2 source lo0').text,/100 percent/);
  second.config('key chain CAMPUS','key 1','key-string DifferentKey','exit','exit');
  assert.doesNotMatch(first.run('sh ip eigrp nei').text,/10\.0\.0\.2/);
  assert.match(first.run('ping 10.2.2.2').text,/0 percent/);
});

test('OSPF admits matching areas, builds inter-area routes and applies redistribution policy',()=>{
  const lab=emptyLab(), first=addDevice(lab,'router'), border=addDevice(lab,'router'), third=addDevice(lab,'router');
  cable(lab,first,'Gi0/0',border,'Gi0/0');cable(lab,border,'Gi0/1',third,'Gi0/0');
  const a=consoleFor(lab,'R1'), b=consoleFor(lab,'R2'), c=consoleFor(lab,'R3');
  a.config('int gi0/0','ip address 10.0.0.1 255.255.255.252','ip ospf 1 area 0','no shut','exit',
    'int lo0','ip address 10.1.1.1 255.255.255.255','ip ospf 1 area 0','exit');
  b.config('int gi0/0','ip address 10.0.0.2 255.255.255.252','ip ospf 1 area 0','no shut','exit',
    'int gi0/1','ip address 10.0.0.5 255.255.255.252','ip ospf 1 area 20','no shut','exit');
  c.config('int gi0/0','ip address 10.0.0.6 255.255.255.252','ip ospf 1 area 20','no shut','exit',
    'int lo0','ip address 10.3.3.3 255.255.255.255','ip ospf 1 area 20','exit',
    'int lo1','ip address 10.9.9.9 255.255.255.255','exit',
    'ip prefix-list EXPORT permit 10.9.9.9/32','route-map EXPORT permit 10','match ip address prefix-list EXPORT','set tag 20','exit',
    'router ospf 1','redistribute connected subnets route-map EXPORT');
  assert.match(b.run('sh ip ospf neighbor').text,/FULL.*area 20/);
  assert.match(a.run('sh ip route ospf').text,/O IA\s+10\.3\.3\.3\/32/);
  assert.match(a.run('sh ip route ospf').text,/O E2\s+10\.9\.9\.9\/32/);
  assert.match(a.run('ping 10.9.9.9 source Lo0').text,/100 percent/);
  c.config('router ospf 1','area 20 stub');
  assert.doesNotMatch(b.run('sh ip ospf nei').text,/10\.0\.0\.6/);
  assert.doesNotMatch(a.run('sh ip route ospf').text,/10\.3\.3\.3/);
  b.config('router ospf 1','area 20 stub no-summary');
  assert.match(c.run('sh ip route ospf').text,/O IA\s+0\.0\.0\.0\/0/);
});

test('VRF forwarding keeps overlapping prefixes isolated across physical links',()=>{
  const lab=emptyLab(), router=addDevice(lab,'router'), a=addDevice(lab,'pc'), b=addDevice(lab,'pc');
  cable(lab,router,'Gi0/0',a,'Eth0');cable(lab,router,'Gi0/1',b,'Eth0');
  const r=consoleFor(lab,'R1'), left=consoleFor(lab,'PC1'), right=consoleFor(lab,'PC2');
  r.config('vrf definition BLUE','rd 65000:10','address-family ipv4','exit-address-family','exit',
    'vrf definition GREEN','rd 65000:20','address-family ipv4','exit','exit',
    'int gi0/0','vrf forwarding BLUE','ip address 10.10.10.1 255.255.255.0','no shut','exit',
    'int gi0/1','vrf forwarding GREEN','ip address 10.10.10.1 255.255.255.0','no shut');
  left.run('ip address 10.10.10.10 24 10.10.10.1');
  right.run('ip address 10.10.10.10 24 10.10.10.1');
  assert.match(r.run('sh ip route vrf BLUE').text,/10\.10\.10\.0\/24.*Gi0\/0/);
  assert.match(r.run('sh ip route vrf GREEN').text,/10\.10\.10\.0\/24.*Gi0\/1/);
  assert.match(r.run('ping vrf BLUE 10.10.10.10').text,/R1 → PC1/);
  assert.match(r.run('ping vrf GREEN 10.10.10.10').text,/R1 → PC2/);
  assert.match(r.run('ping 10.10.10.10').text,/0 percent/);
});

test('GRE uses a reachable routed underlay, matching keys, and carries IPv4 and IPv6',()=>{
  const lab=emptyLab(), a=addDevice(lab,'router'), transit=addDevice(lab,'router'), b=addDevice(lab,'router');
  cable(lab,a,'Gi0/0',transit,'Gi0/0');cable(lab,transit,'Gi0/1',b,'Gi0/0');
  const left=consoleFor(lab,'R1'), mid=consoleFor(lab,'R2'), right=consoleFor(lab,'R3');
  left.config('int gi0/0','ip address 192.0.2.1 255.255.255.252','no shut','exit','ip route 198.51.100.0 255.255.255.252 192.0.2.2',
    'int tunnel72','ip address 10.77.12.1 255.255.255.252','ipv6 address 2001:db8:7712::1/64','tunnel source gi0/0',
    'tunnel destination 198.51.100.2','tunnel key 72','keepalive 5 3');
  mid.config('int gi0/0','ip address 192.0.2.2 255.255.255.252','no shut','exit','int gi0/1','ip address 198.51.100.1 255.255.255.252','no shut');
  right.config('int gi0/0','ip address 198.51.100.2 255.255.255.252','no shut','exit','ip route 192.0.2.0 255.255.255.252 198.51.100.1',
    'int tu72','ip address 10.77.12.2 255.255.255.252','ipv6 address 2001:db8:7712::2/64','tunnel source gi0/0',
    'tunnel destination 192.0.2.1','tunnel key 72');
  assert.match(left.run('show tunnel interface Tunnel72').text,/line protocol is up/);
  assert.match(left.run('ping 10.77.12.2').text,/R1 → R2 → R3/);
  assert.match(left.run('ping 2001:db8:7712::2').text,/R1 → R2 → R3/);
  right.config('int tunnel72','tunnel key 73');
  assert.match(left.run('show tunnel interface Tu72').text,/line protocol is down/);
  assert.match(left.run('ping 10.77.12.2').text,/0 percent/);
  right.config('int tunnel72','tunnel key 72');
  mid.config('int gi0/1','shutdown');
  assert.match(left.run('ping 10.77.12.2').text,/0 percent/);
});

test('HSRP follows IP SLA priority tracking and a tracked static route withdraws',()=>{
  const lab=emptyLab(), one=addDevice(lab,'router'), two=addDevice(lab,'router'), third=addDevice(lab,'router'),
    sw=addDevice(lab,'switch'), pc=addDevice(lab,'pc');
  cable(lab,sw,'Gi0/1',one,'Gi0/0');cable(lab,sw,'Gi0/2',two,'Gi0/0');cable(lab,sw,'Gi0/3',third,'Gi0/0');cable(lab,sw,'Gi0/4',pc,'Eth0');
  cable(lab,one,'Gi0/1',third,'Gi0/1');
  const r1=consoleFor(lab,'R1'), r2=consoleFor(lab,'R2'), r3=consoleFor(lab,'R3'), host=consoleFor(lab,'PC1');
  r1.config('int gi0/0','ip address 10.0.0.1 255.255.255.0','no shut','standby 1 ip 10.0.0.254','standby 1 priority 120','standby 1 preempt',
    'standby 1 track 66 decrement 50','exit','int gi0/1','ip address 192.0.2.9 255.255.255.252','no shut','exit',
    'ip sla 66','icmp-echo 192.0.2.10 source-interface gi0/1','frequency 5','exit','ip sla schedule 66 life forever start-time now',
    'track 66 ip sla 66 reachability','ip route 203.0.113.0 255.255.255.0 192.0.2.10 track 66',
    'ip route 203.0.113.0 255.255.255.0 10.0.0.3 200');
  r2.config('int gi0/0','ip address 10.0.0.2 255.255.255.0','no shut','standby 1 ip 10.0.0.254','standby 1 preempt','exit',
    'ip route 203.0.113.0 255.255.255.0 10.0.0.3');
  r3.config('int gi0/0','ip address 10.0.0.3 255.255.255.0','no shut','exit','int gi0/1','ip address 192.0.2.10 255.255.255.252','no shut',
    'exit','int loopback0','ip address 203.0.113.5 255.255.255.255');
  host.run('ip address 10.0.0.5 24 10.0.0.254');
  assert.match(r1.run('show ip sla statistics 66').text,/code: OK/);
  assert.match(r1.run('show standby brief').text,/Active.*120/);
  assert.match(host.run('ping 203.0.113.5').text,/PC1 → SW1 → R1 → R3/);
  r3.config('int gi0/1','shutdown');
  assert.match(r1.run('show track 66').text,/Down/);
  assert.match(r1.run('show ip route 203.0.113.5').text,/\[200\/0\] via 10.0.0.3/);
  assert.match(r2.run('show standby brief').text,/Active.*100/);
  assert.match(host.run('ping 203.0.113.5').text,/PC1 → SW1 → R2 → SW1 → R3/);
  r3.config('int gi0/1','no shutdown');
  assert.match(r1.run('show standby brief').text,/Active.*120/);
});

test('NetFlow records live traffic and exports only to a reachable matching UDP collector',()=>{
  const lab=enterpriseLab(), pc=consoleFor(lab,'PC2'), r=consoleFor(lab,'R1'), server=consoleFor(lab,'SRV1');
  r.config('flow record TRAFFIC','match ipv4 source address','match ipv4 destination address','match ipv4 protocol',
    'collect counter packets long','exit','flow exporter TELEMETRY','destination 10.72.100.30','source gi0/0.100','transport udp 2055',
    'export-protocol ipfix','exit','flow monitor CAMPUS','record TRAFFIC','exporter TELEMETRY','exit',
    'int gi0/0.110','ip flow monitor CAMPUS input');
  pc.run('dot1x login student NetraStudent');pc.run('ipconfig /renew');
  assert.match(r.run('show flow monitor CAMPUS cache').text,/No flow cache/);
  assert.match(pc.run('ping -c 3 203.0.113.53').text,/\(3\/3\)/);
  assert.match(r.run('show flow monitor CAMPUS cache format table').text,/10\.72\.110\.21\s+203\.0\.113\.53\s+icmp\s+3/);
  assert.match(server.run('show netflow').text,/203\.0\.113\.53.*3 packets.*ipfix/);
  server.run('netflow port 9995');
  assert.match(pc.run('ping -c 2 203.0.113.53').text,/\(2\/2\)/);
  assert.match(r.run('show flow monitor CAMPUS cache').text,/203\.0\.113\.53\s+icmp\s+5/);
  assert.match(r.run('show flow exporter TELEMETRY').text,/Records exported: 1/);
});

test('IPv6 clients acquire SLAAC or relayed DHCPv6 and switch RA Guard blocks advertisements',()=>{
  const lab=emptyLab(), router=addDevice(lab,'router'), sw=addDevice(lab,'switch'), a=addDevice(lab,'pc'), server=addDevice(lab,'server');
  cable(lab,router,'Gi0/0',sw,'Gi0/1');cable(lab,sw,'Gi0/2',a,'Eth0');cable(lab,router,'Gi0/1',server,'Eth0');
  const r=consoleFor(lab,'R1'), pc=consoleFor(lab,'PC1'), sr=consoleFor(lab,'SRV1'), acc=consoleFor(lab,'SW1');
  r.config('ipv6 unicast-routing','int gi0/0','ipv6 address 2001:db8:7:1::1/64','ipv6 nd managed-config-flag',
    'ipv6 dhcp relay destination 2001:db8:7:2::2 gi0/1','no shut','exit','int gi0/1','ipv6 address 2001:db8:7:2::1/64','no shut');
  sr.run('ipv6 address 2001:db8:7:2::2/64 2001:db8:7:2::1');
  sr.run('service dhcpv6 on');
  sr.run('dhcp6 scope CLIENTS 2001:db8:7:1::/64 2001:db8:7:2::2');
  assert.match(pc.run('ipv6 autoconfig').text,/SLAAC address: 2001:db8:7:1:/);
  assert.match(pc.run('ping 2001:db8:7:2::2').text,/100 percent/);
  assert.match(pc.run('ipconfig /renew6').text,/DHCPv6 address: 2001:db8:7:1::10\/64 from SRV1/);
  assert.match(pc.run('ping 2001:db8:7:2::2').text,/100 percent/);
  assert.match(sr.run('show dhcp6 bindings').text,/PC1.*2001:db8:7:1::10/);
  acc.config('ipv6 nd raguard policy HOST','device-role host','exit','int gi0/1','ipv6 nd raguard attach-policy HOST');
  assert.match(pc.run('ipv6 autoconfig').text,/No usable IPv6 router advertisement/);
  assert.match(acc.run('show ipv6 nd raguard policy').text,/HOST.*Gi0\/1/);
});

test('transport ACLs block HTTP on the modeled path and leave allowed ICMP alone',()=>{
  const lab=enterpriseLab(), pc=consoleFor(lab,'PC2'), r=consoleFor(lab,'R1');
  pc.run('dot1x login student NetraStudent');
  pc.run('ipconfig /renew');
  r.config('ip access-list extended STAFF-IN','deny tcp any host 10.72.100.30 eq www','permit ip any any','exit',
    'int gi0/0.110','ip access-group STAFF-IN in');
  assert.match(pc.run('curl http://10.72.100.30/status').text,/inbound access list denied TCP/);
  assert.match(pc.run('ping 10.72.100.30').text,/100 percent/);
  assert.match(r.run('show ip access-lists STAFF-IN').text,/deny tcp .* \(1 matches\)/);
  r.config('int gi0/0.110','no ip access-group STAFF-IN in');
  assert.match(pc.run('curl http://10.72.100.30/status').text,/200 OK/);
});

test('a matching ingress PBR route map changes the next hop without replacing the RIB',()=>{
  const lab=emptyLab(), edge=addDevice(lab,'router'), normal=addDevice(lab,'router'), preferred=addDevice(lab,'router'),
    vlan=addDevice(lab,'switch'), client=addDevice(lab,'pc');
  cable(lab,edge,'Gi0/0',client,'Eth0');cable(lab,edge,'Gi0/1',vlan,'Gi0/1');
  cable(lab,normal,'Gi0/0',vlan,'Gi0/2');cable(lab,preferred,'Gi0/0',vlan,'Gi0/3');
  const a=consoleFor(lab,'R1'), b=consoleFor(lab,'R2'), c=consoleFor(lab,'R3'), pc=consoleFor(lab,'PC1');
  a.config('int gi0/0','ip address 10.1.0.1 255.255.255.0','no shut','exit',
    'int gi0/1','ip address 10.2.0.1 255.255.255.0','no shut','exit','ip route 203.0.113.8 255.255.255.255 10.2.0.2');
  b.config('int gi0/0','ip address 10.2.0.2 255.255.255.0','no shut','exit','ip route 203.0.113.8 255.255.255.255 10.2.0.3');
  c.config('int gi0/0','ip address 10.2.0.3 255.255.255.0','no shut','exit',
    'int lo0','ip address 203.0.113.8 255.255.255.255','exit','ip route 10.1.0.0 255.255.255.0 10.2.0.1');
  pc.run('ip address 10.1.0.20 24 10.1.0.1');
  assert.match(pc.run('ping 203.0.113.8').text,/→ R2 → SW1 → R3/);
  a.config('access-list 5 permit 10.1.0.0 0.0.0.255','route-map CLIENTS permit 10','match ip address 5','set ip next-hop 10.2.0.3',
    'exit','int gi0/0','ip policy route-map CLIENTS');
  assert.match(a.run('show ip policy').text,/Gi0\/0.*CLIENTS/);
  assert.match(a.run('show ip route 203.0.113.8').text,/via 10\.2\.0\.2/);
  assert.match(pc.run('ping 203.0.113.8').text,/Path: PC1 → R1 → SW1 → R3/);
});
