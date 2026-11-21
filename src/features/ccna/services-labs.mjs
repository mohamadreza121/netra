import { set, field, lines } from './engine.mjs';
import { helpers } from './network-labs.mjs';

const { r, r2, sw, pc, enable, config, end, exit, port, show } = helpers;

function natTraffic(s, local, transport = null) {
  if (!s.inside || !s.outside) return 'No translation: verify NAT inside and outside interfaces.';
  if (local === '10.10.10.50' && s.fixed) {
    s.staticHits = (s.staticHits ?? 0) + 1;
    return 'Translated source 10.10.10.50 → 198.51.100.50';
  }
  if (!s.pool || !s.match || !s.binding) return 'No translation: verify the source ACL, pool, and mapping.';
  if (s.overload && transport) {
    s.pat ??= {};
    const key = local + ':' + transport;
    s.pat[key] ??= 40000 + Object.keys(s.pat).length;
    return `Translated TCP source ${key} → 198.51.100.10:${s.pat[key]}`;
  }
  s.dynamic = local;
  return 'Translated source ' + local + ' → 198.51.100.10';
}

const translations = s => lines('Pro  Inside global    Inside local    Outside local  Outside global',
  ...(s.fixed ? ['---  198.51.100.50    10.10.10.50     ---            ---'] : []),
  ...(s.dynamic ? [`---  198.51.100.10    ${s.dynamic}     ---            ---`] : []),
  ...Object.entries(s.pat ?? {}).map(([key, port]) => `tcp  198.51.100.10:${port}  ${key}  203.0.113.9:80  203.0.113.9:80`));

function aclPacket(s, type) {
  if (!s.filter) return 'No inbound ACL applied. Packet permitted.';
  const matched = type === 'https' ? s.allow443 : type === 'dns' ? s.allowDns : s.denyLog;
  const permit = matched && type !== 'icmp';
  if (matched || s.denyLog) {
    const counter = permit ? type : 'deny';
    s[counter] = (s[counter] ?? 0) + 1;
  }
  return permit ? 'Packet permitted by EDGE-IN.' : s.denyLog ? 'Packet denied and logged by EDGE-IN.' : 'Packet dropped by the implicit deny.';
}

export const servicesLabs = [
  {
    id:'nat',domain:4,title:'Inside source NAT',objectives:'4.1',source:'Vol. 2 · Ch. 10',
    devices:[r,pc],topology:['Inside hosts', 'R1 NAT', 'Outside network'],task:'Configure static NAT and a dynamic pool, then generate packets and inspect translations.',
    steps:[
      enable(r),config(r),port(r,'GigabitEthernet0/0'),[r,'ip nat inside','Mark the LAN-facing interface as inside.',set('inside',true)],exit(r),
      port(r,'GigabitEthernet0/1'),[r,'ip nat outside','Mark the upstream-facing interface as outside.',set('outside',true)],exit(r),
      [r,'ip nat inside source static 10.10.10.50 198.51.100.50','Give the server a stable inside-global address.',set('fixed',true)],
      [r,'access-list 1 permit 10.10.10.0 0.0.0.255','Select inside source addresses eligible for dynamic NAT.',set('match',true)],
      [r,'ip nat pool PUBLIC 198.51.100.10 198.51.100.20 netmask 255.255.255.0','Define a range of inside-global addresses.',set('pool',true)],
      [r,'ip nat inside source list 1 pool PUBLIC','Bind the source ACL to the pool.',set('binding',true)],end(r),
      show(r,'show ip nat translations','Inspect the static entry before generating dynamic traffic.',translations),
      [pc,'ping 203.0.113.9','Send traffic from PC1 (10.10.10.11) toward the outside network.',s=>natTraffic(s,'10.10.10.11')],
      show(r,'show ip nat translations','Confirm a dynamic inside-local to inside-global mapping appeared.',translations),
      show(r,'show ip nat statistics','Check interface roles and dynamic allocations.',s=>lines(`Inside interfaces: ${s.inside?'Gi0/0':'none'}`,`Outside interfaces: ${s.outside?'Gi0/1':'none'}`,`Total active translations: ${Number(Boolean(s.fixed))+Number(Boolean(s.dynamic))+Object.keys(s.pat??{}).length}`,`Pool PUBLIC allocated: ${s.dynamic?1:0}`)),
      [r,'clear ip nat translation *','Remove the dynamic lab translation. The static mapping remains.',s=>{s.dynamic=null;s.pat={};}],
      show(r,'show ip nat translations','Verify the dynamic entry was removed.',translations),
      config(r),[r,'ip nat inside source list 1 pool PUBLIC overload','Add port address translation (PAT) to this mapping.',set('overload',true)],end(r),
      [pc,'curl http://203.0.113.9','Open the first TCP connection from lab source port 49152.',s=>natTraffic(s,'10.10.10.11',49152)],
      [pc,'curl --local-port 49153 http://203.0.113.9','Open a second connection. Both share an inside-global IP and use different translated ports.',s=>natTraffic(s,'10.10.10.11',49153)],
      show(r,'show ip nat translations','Compare the two PAT entries.',translations),
      show(r,'show running-config','Inspect the static and overload configuration.'),
    ]
  },
  {
    id:'dhcp',domain:4,title:'DHCP client, server and relay',objectives:'4.3 · 4.6',source:'Vol. 2 · Ch. 7',
    devices:[r,r2,pc],topology:['Client 192.168.30.0/24','R1 relay','R2 10.0.12.2'],task:'Relay a PC lease to a central DHCP server and obtain an address for a router interface.',
    steps:[
      enable(r2),config(r2),[r2,'ip dhcp excluded-address 192.168.30.1 192.168.30.20','Reserve infrastructure addresses.',set('excluded',true)],
      [r2,'ip dhcp pool USERS','Create a DHCP pool.',set('pool',true)],
      [r2,'network 192.168.30.0 255.255.255.0','Assign the client subnet to the pool.',set('subnet',true)],
      [r2,'default-router 192.168.30.1','Supply the client gateway.',set('gateway','192.168.30.1')],
      [r2,'dns-server 192.0.2.53','Supply the DNS resolver.',set('dns','192.0.2.53')],end(r2),
      enable(r),config(r),port(r,'GigabitEthernet0/0'),[r,'ip helper-address 10.0.12.2','Forward client broadcasts to the central DHCP server.',set('helper',true)],exit(r),
      port(r,'GigabitEthernet0/1'),[r,'ip address dhcp','Configure this interface as a DHCP client of a separate upstream service.',set('wanAddress','198.51.100.12')],
      [r,'no shutdown','Bring the DHCP client link up.',set('wanUp',true)],end(r),
      [pc,'ipconfig /renew','Request or renew a lease through the relay.',s=>{if(!s.helper||!s.pool||!s.subnet)return 'Unable to contact DHCP server.'; s.lease=s.excluded?'192.168.30.21':'192.168.30.1';return `IPv4 Address: ${s.lease}\nDefault Gateway: ${field(s,'gateway')}\nDNS Servers: ${field(s,'dns')}`;}],
      show(r2,'show ip dhcp binding','Find the lease assigned to the PC.',s=>s.lease?`IP address       Client-ID          Type\n${s.lease}   0102.0000.0000.11  Automatic`:'No bindings.'),
      show(r2,'show ip dhcp pool USERS','Inspect the configured scope and assigned leases.',s=>s.subnet?`Pool USERS\n  Leased addresses: ${s.lease?1:0}\n  Network: 192.168.30.0/24`:'No configured scope.'),
      show(r,'show ip interface brief','Verify the WAN port obtained a DHCP address.',s=>`GigabitEthernet0/1  ${s.wanUp?field(s,'wanAddress','unassigned'):'unassigned'}  ${s.wanUp?'up/up':'down/down'}`)
    ]
  },
  {
    id:'management-services',domain:4,title:'NTP, syslog and SNMP',objectives:'4.2 · 4.4 · 4.5 · 4.9',source:'Vol. 2 · Ch. 9, 12',
    devices:[r,r2],topology:['R1 client', 'NTP', 'R2 time source'],task:'Synchronize a router, route logs to a collector, and configure a read-only SNMPv3 view.',
    steps:[
      enable(r2),config(r2),[r2,'ntp master 4','Use R2 as a stratum 4 lab source.',set('master',4)],end(r2),
      enable(r),config(r),[r,'ntp server 10.0.12.2 prefer','Use R2 as R1’s preferred time source.',set('ntp',true)],
      [r,'service timestamps log datetime msec','Add millisecond timestamps to logs.',set('timestamps',true)],
      [r,'logging host 192.0.2.60','Send logs to the lab collector.',set('collector','192.0.2.60')],
      [r,'logging trap warnings','Forward levels 0 through 4.',set('severity','warnings (0–4)')],
      [r,'logging buffered 16384','Keep an in-memory log buffer.',set('buffer',16384)],
      [r,'snmp-server view NETRA iso included','Build a lab MIB view.',set('snmpView',true)],
      [r,'snmp-server group MONITOR v3 priv read NETRA','Define a read view that requires SNMPv3 privacy.',set('snmpGroup',true)],end(r),
      show(r,'show ntp associations','Check the selected time source.',s=>s.master&&s.ntp?'*~10.0.12.2  configured   selected   stratum 4':'No selected association.'),
      show(r,'show ntp status','Check whether the client clock is synchronized.',s=>s.master&&s.ntp?'Clock is synchronized, stratum 5, reference is 10.0.12.2':'Clock is unsynchronized.'),
      show(r,'show logging','Review log destination and severity threshold.',s=>lines(`Logging to: ${field(s,'collector')}`,`Trap level: ${field(s,'severity')}`,`Buffer: ${field(s,'buffer',0)} bytes`,s.timestamps?'Timestamps enabled':'Timestamps disabled')),
      show(r,'show snmp group','Verify the security model and read view.',s=>s.snmpView&&s.snmpGroup?'groupname: MONITOR    security model: v3 priv\nreadview: NETRA':'No MONITOR group.'),
      [r,'copy running-config startup-config','Save the working configuration locally.']
    ]
  },
  {
    id:'ssh',domain:5,title:'Local access controls and SSH',objectives:'2.8 · 4.8 · 5.3',source:'Vol. 1 · Ch. 6 · Vol. 2 · Ch. 5',
    devices:[sw,pc],topology:['Admin PC','SSH v2','SW1'],task:'Prepare local authentication, generate RSA keys, and verify SSH-only management access.',
    steps:[
      enable(sw),config(sw),[sw,'hostname ACCESS1','Set the IOS hostname.',set('hostname:SW1','ACCESS1')],
      [sw,'enable secret NetraEnable42','Set a lab-only privileged EXEC secret.',set('enableSecret',true)],
      [sw,'username operator privilege 15 secret NetraLab42','Add a lab-only local administrator.',set('user',true)],
      [sw,'ip domain-name netra.example','Set the domain name used for RSA key generation.',set('domain',true)],
      [sw,'crypto key generate rsa general-keys modulus 2048','Create the SSH RSA key pair.',s=>{if(!s.domain||!s['hostname:SW1'])return {error:'% Configure a hostname and domain name first.'}; s.key=true;return '2048-bit RSA keys generated.';}],
      [sw,'ip ssh version 2','Require SSH version 2.',set('version',2)],
      [sw,'line console 0','Configure physical console access.'],[sw,'login local','Require the local username and secret at the console.',set('console',true)],exit(sw),
      [sw,'line vty 0 15','Select remote terminal lines.'],[sw,'login local','Use the local user database for remote sessions.',set('local',true)],
      [sw,'transport input ssh','Allow SSH as inbound VTY transport.',set('ssh',true)],
      [sw,'exec-timeout 5 0','Close idle sessions after five minutes.',set('idle',5)],end(sw),
      show(sw,'show ip ssh','Verify SSH is enabled and version 2 is selected.',s=>s.key&&s.version?'SSH Enabled - version 2.0':'SSH Disabled'),
      show(sw,'show running-config','Review the console and VTY configuration.'),
      [pc,'ssh operator@192.168.99.11','Attempt a lab SSH connection as the configured local user.',s=>s.key&&s.user&&s.version&&s.local&&s.ssh?'SSH v2 session accepted for operator (lab authentication).':'SSH session rejected: check keys, user and VTY settings.']
    ]
  },
  {
    id:'acl',domain:5,title:'IPv4 standard and extended ACLs',objectives:'5.6',source:'Vol. 2 · Ch. 2–3',
    devices:[r,pc],topology:['PC1 10.10.10.11','R1 Gi0/0 inbound','Web / DNS servers'],task:'Restrict remote management and apply an extended interface ACL. Test HTTPS, DNS and ICMP.',
    steps:[
      enable(r),config(r),
      [r,'access-list 7 permit host 192.168.99.25','Compare a numbered standard rule matching one management host.',set('acl7',true)],
      [r,'access-list 100 permit tcp any host 203.0.113.80 eq 443','Compare a numbered extended rule matching HTTPS.',set('acl100',true)],
      [r,'ip access-list standard MGMT','Create a named ACL that only checks source IPv4.',set('mgmt',true)],
      [r,'10 permit 192.168.99.0 0.0.0.255','Allow the management subnet.',set('mgmtRule',true)],exit(r),
      [r,'line vty 0 4','Enter VTY configuration.'],[r,'access-class MGMT in','Apply the management ACL to inbound VTY sessions.',set('vtyAcl',true)],exit(r),
      [r,'ip access-list extended EDGE-IN','Create a named ACL that checks protocol, addresses and ports.',set('edge',true)],
      [r,'10 permit tcp 10.10.10.0 0.0.0.255 host 203.0.113.80 eq 443','Permit the users’ HTTPS traffic to the web host.',set('allow443',true)],
      [r,'20 permit udp any host 192.0.2.53 eq 53','Permit UDP DNS to the lab resolver.',set('allowDns',true)],
      [r,'30 deny ip any any log','Log other traffic so the deny is visible.',set('denyLog',true)],exit(r),
      port(r,'GigabitEthernet0/0'),[r,'ip access-group EDGE-IN in','Filter traffic entering from the LAN.',set('filter',true)],end(r),
      show(r,'show ip interface GigabitEthernet0/0','Verify which ACL is applied and in what direction.',s=>`Inbound access list is ${s.filter?'EDGE-IN':'not set'}\nOutgoing access list is not set`),
      [pc,'curl https://203.0.113.80','Send simulated TCP port 443 traffic.',s=>aclPacket(s,'https')],
      [pc,'nslookup netra.example 192.0.2.53','Send simulated UDP port 53 traffic.',s=>aclPacket(s,'dns')],
      [pc,'ping 203.0.113.80','Send ICMP, which matches the explicit deny in this lab.',s=>aclPacket(s,'icmp')],
      show(r,'show access-lists','Inspect sequence numbers and per-rule counters.',s=>lines(
        ...(s.acl7?['Standard IP access list 7: permit host 192.168.99.25']:[]),
        ...(s.acl100?['Extended IP access list 100: permit tcp any host 203.0.113.80 eq 443']:[]),
        ...(s.mgmt?['Standard IP access list MGMT',...(s.mgmtRule?['    10 permit 192.168.99.0, wildcard bits 0.0.0.255']:[])]:[]),
        ...(s.edge?['Extended IP access list EDGE-IN',
        ...(s.allow443?[`    10 permit tcp 10.10.10.0 0.0.0.255 host 203.0.113.80 eq 443 (${s.https??0} matches)`]:[]),
        ...(s.allowDns?[`    20 permit udp any host 192.0.2.53 eq 53 (${s.dns??0} matches)`]:[]),
        ...(s.denyLog?[`    30 deny ip any any log (${s.deny??0} matches)`]:[])]:[]))),
      config(r),[r,'ip access-list extended EDGE-IN','Edit the existing policy.'],[r,'no 20','Remove the DNS permit by sequence number.',set('allowDns',false)],end(r),
      [pc,'nslookup netra.example 192.0.2.53','Retry DNS and observe that it now hits the deny.',s=>aclPacket(s,'dns')]
    ]
  },
  {
    id:'l2-security',domain:5,title:'Port security, DHCP snooping and DAI',objectives:'5.7',source:'Vol. 2 · Ch. 6–8',
    devices:[sw],topology:['Trusted uplink Gi0/24','SW1','Access port Gi0/1'],task:'Trust the DHCP uplink while protecting the untrusted edge port and checking ARP inspection state.',
    steps:[
      enable(sw),config(sw),[sw,'ip dhcp snooping','Enable DHCP snooping globally.',set('snooping',true)],
      [sw,'ip dhcp snooping vlan 10','Enable checking for VLAN 10.',set('snoopVlan',10)],
      [sw,'ip arp inspection vlan 10','Validate ARP on VLAN 10 using trusted binding data.',set('arp',true)],
      port(sw,'GigabitEthernet0/24'),[sw,'ip dhcp snooping trust','Allow DHCP server messages from the trusted uplink.',set('trustedDhcp',true)],
      [sw,'ip arp inspection trust','Trust ARP received on the upstream infrastructure link.',set('trustedArp',true)],exit(sw),
      port(sw,'GigabitEthernet0/1'),[sw,'switchport mode access','Configure a fixed access port.',set('access',true)],
      [sw,'switchport access vlan 10','Assign the edge port to VLAN 10.',set('accessVlan',10)],
      [sw,'ip dhcp snooping limit rate 15','Set the untrusted DHCP rate limit.',set('rate',15)],
      [sw,'switchport port-security','Enable secure MAC checks.',set('portSafe',true)],
      [sw,'switchport port-security maximum 2','Allow up to two secure MACs.',set('max',2)],
      [sw,'switchport port-security mac-address sticky','Learn secure addresses into the configuration.',set('sticky',true)],
      [sw,'switchport port-security violation restrict','Drop violating traffic and count violations without shutting the port.',set('violation','Restrict')],end(sw),
      show(sw,'show port-security interface GigabitEthernet0/1','Verify the maximum, mode and sticky setting.',s=>lines(`Port Security: ${s.portSafe?'Enabled':'Disabled'}`,`Maximum MAC Addresses: ${field(s,'max',1)}`,`Violation Mode: ${field(s,'violation','Shutdown')}`,`Sticky Learning: ${s.sticky?'Enabled':'Disabled'}`)),
      show(sw,'show ip dhcp snooping','Check VLAN scope, trust and rate limit.',s=>lines(`DHCP Snooping: ${s.snooping?'enabled':'disabled'}`,`Configured VLANs: ${field(s,'snoopVlan')}`,`Gi0/24 trusted: ${s.trustedDhcp?'yes':'no'}`,`Gi0/1 rate limit: ${field(s,'rate')} pps`)),
      show(sw,'show ip dhcp snooping binding','Inspect the binding learned from the lab’s existing DHCP exchange.',s=>s.snooping&&s.trustedDhcp&&s.snoopVlan===s.accessVlan?'02:00:00:00:00:11  192.168.10.11  dhcp-snooping  10  Gi0/1':'No bindings.'),
      show(sw,'show ip arp inspection interfaces','Verify Gi0/24 is trusted and Gi0/1 remains untrusted.',s=>lines(`VLAN 10 inspection: ${s.arp?'enabled':'disabled'}`,`Gi0/24  ${s.trustedArp?'Trusted':'Untrusted'}`, 'Gi0/1   Untrusted'))
    ]
  }
];
