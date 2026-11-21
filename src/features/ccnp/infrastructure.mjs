import { lesson, configure, config, exec, shell, toggle, observe, read, all, assign } from './lesson.mjs';
const c=configure;

export const infrastructure = [
  lesson({
    id:'trunks-dtp-vtp',title:'VLANs, DTP, 802.1Q and VTP',topics:{encor:['3.1.a']},portable:[1],guide:[5],
    topology:['PC1 · VLAN 72','SW1 · Distribution','SW2 · Access','PC2 · VLAN 72'],
    task:'Diagnose a trunk that stays down in dynamic auto and then carry the intended VLANs. Check VTP mode, database and the distinction between the native VLAN and the allowed list.'
  }, [
    exec('SW1',[observe('show interfaces trunk','Find whether an operational trunk exists.',all('trunk','allowed'),
      'Port    Mode      Encapsulation  Status     Native vlan\nGi0/1   on        802.1q         trunking   799\nVlans allowed on trunk: 72,84,799','No interfaces are trunking.')]),
    config('SW1',[
      ['vtp domain NETRA-CAMPUS','Set the lab VTP management domain.'],
      ['vtp mode transparent','Keep VLAN changes local to this switch.'],
      ['vtp version 2','Practice the explicit version knob in the isolated lab.']
    ]),
    c('SW1',['vlan 72'],[['name ENGINEERING','Label the access VLAN for verification.']]),
    c('SW1',['vlan 84'],[['name VOICE-OPS','Create the separate voice VLAN.']]),
    c('SW1',['vlan 799'],[['name NATIVE-TRANSIT','Reserve a matching native VLAN for the trunk.']]),
    c('SW1',['interface range GigabitEthernet0/2 - 4'],[
      ['switchport mode access','Select static access mode on the edge ports.'],
      ['switchport access vlan 72','Map data traffic to the engineering VLAN.'],
      ['switchport voice vlan 84','Permit the tagged voice VLAN alongside the data VLAN.'],
      ['spanning-tree portfast','Use edge convergence for directly attached user devices.']
    ]),
    c('SW1',['interface GigabitEthernet0/1'],[
      ['switchport mode dynamic auto','Observe why two passive DTP endpoints do not form a trunk.'],
      ['switchport mode dynamic desirable','Actively negotiate a trunk with an auto neighbor.',assign({trunk:true})],
      ['switchport mode trunk','Make the final trunk static.',assign({trunk:true})],
      ['switchport nonegotiate','Disable DTP on the statically configured link.'],
      ['switchport trunk native vlan 799','Tag other allowed VLANs and match the native VLAN on both ends.'],
      toggle('switchport trunk allowed vlan 72,84,799','Replace the allowed list with the intended VLANs.','allowed'),
      ['switchport trunk allowed vlan add 170','Practice adding a temporary VLAN without replacing the list.'],
      ['switchport trunk allowed vlan remove 170','Remove the temporary VLAN from the list.']
    ]),
    c('SW2',['interface GigabitEthernet0/1'],[
      ['switchport mode trunk','Set the far side to a static trunk before disabling DTP.'],
      ['switchport nonegotiate','Stop sending negotiation frames on this side.'],
      ['switchport trunk native vlan 799','Match the native VLAN.'],
      ['switchport trunk allowed vlan 72,84,799','Carry the same VLANs on both endpoints.']
    ]),
    exec('SW1',[
      observe('show interfaces trunk','Verify the final static trunk and allowed VLANs.',all('trunk','allowed'),
        'Port    Mode      Encapsulation  Status     Native vlan\nGi0/1   on        802.1q         trunking   799\nVlans allowed on trunk: 72,84,799','No interfaces are trunking.'),
      read('show interfaces GigabitEthernet0/1 switchport','Compare administrative and operational switchport mode.','Administrative Mode: trunk\nOperational Mode: trunk\nNegotiation of Trunking: Off\nTrunking Native Mode VLAN: 799'),
      read('show dtp interface GigabitEthernet0/1','Inspect DTP state and encapsulation for the selected port.','DTP administrative status: disabled\n802.1Q trunk is statically configured.'),
      read('show vtp status','Verify the active domain and whether revision changes are locally significant.','Domain Name: NETRA-CAMPUS\nOperating Mode: Transparent\nRunning VTP version: 2'),
      read('show vtp counters','Inspect joined-domain advertisements separately from actual forwarding.','Summary advertisements received: 0\nSubset advertisements received: 0'),
      read('show vlan brief','Confirm access-port membership and voice VLAN presence.','72   ENGINEERING      active Gi0/2, Gi0/3, Gi0/4\n84   VOICE-OPS        active\n799  NATIVE-TRANSIT   active'),
      read('show vlan id 72','Narrow verification to a single VLAN ID.','72  ENGINEERING  active  Gi0/2, Gi0/3, Gi0/4'),
      ['copy running-config startup-config','Save the IOS-style configuration in the session.']
    ])
  ]),

  lesson({
    id:'etherchannel-lacp',title:'LACP, PAgP and routed EtherChannel',topics:{encor:['3.1.b'],enarsi:[]},portable:[1],guide:[5],
    topology:['SW1 · LACP active','SW2 · LACP passive','SW3 · Routed port-channel example'],
    task:'Bring up a two-link bundle, verify which ports joined, and prepare separate PAgP and routed examples.'
  }, [
    exec('SW1',[observe('show etherchannel summary','Check which links are actually bundled.',all('active','passive'),
       '21  Po21(SU)  LACP  Gi0/1(P) Gi0/2(P)','21  Po21(SD)  LACP  Gi0/1(I) Gi0/2(I)')]),
    config('SW1',[
      ['port-channel load-balance src-dst-ip','Use a source/destination IP hash for eligible traffic.'],
      ['lacp system-priority 32000','Set the system priority used in LACP selection.']
    ]),
    c('SW1',['interface range GigabitEthernet0/1 - 2'],[
      ['switchport mode trunk','Ensure the members use consistent switchport modes.'],
      ['switchport trunk allowed vlan 72,84','Set matching allowed VLAN lists.'],
      toggle('channel-group 21 mode active','Enable active LACP on the selected members.','active'),
      ['lacp rate fast','Request faster LACP periodic exchanges.'],
      ['lacp port-priority 100','Help select a preferred active member when links exceed the limit.']
    ]),
    c('SW1',['interface Port-channel21'],[
      ['switchport mode trunk','Configure the logical bundle as a trunk.'],
      ['switchport trunk allowed vlan 72,84','Apply consistent Layer 2 settings on the logical bundle.'],
      ['port-channel min-links 1','Keep the bundle operational while at least one link is active.'],
      ['lacp max-bundle 2','Allow at most two member ports to forward.']
    ]),
    c('SW2',['interface range GigabitEthernet0/1 - 2'],[
      ['switchport mode trunk','Match the far side’s member mode.'],
      ['switchport trunk allowed vlan 72,84','Match the allowed VLAN list.'],
      toggle('channel-group 21 mode passive','Let the active peer initiate LACP.','passive')
    ]),
    c('SW1',['interface range GigabitEthernet0/3 - 4'],[
      ['channel-protocol pagp','Select legacy Cisco PAgP where supported.'],
      ['channel-group 31 mode desirable','Initiate PAgP negotiation toward an auto or desirable peer.']
    ]),
    c('SW3',['interface range GigabitEthernet0/1 - 2'],[
      ['no switchport','Make the members Layer 3 interfaces.'],
      ['channel-group 7 mode on','Build a statically bundled channel. Configure both ends consistently.']
    ]),
    c('SW3',['interface Port-channel7'],[
      ['no switchport','Use a routed logical interface.'],
      ['ip address 192.0.2.81 255.255.255.252','Assign the IP address to the logical group.'],
      ['no shutdown','Enable the routed bundle.']
    ]),
    exec('SW1',[
      observe('show etherchannel summary','Verify bundle flags and each member’s P marker.',all('active','passive'),
        '21  Po21(SU)  LACP  Gi0/1(P) Gi0/2(P)\n31  Po31(SD)  PAgP  Gi0/3(I) Gi0/4(I)','21  Po21(SD)  LACP  Gi0/1(I) Gi0/2(I)'),
      observe('show etherchannel 21 detail','Inspect the operational protocol, member selection and port-channel association.',all('active','passive'),
        'Group 21: Protocol LACP\nPort-channel21 is up\nGi0/1, Gi0/2 are in the bundle','Group 21 has no negotiated members.'),
      observe('show lacp neighbor','Verify the far-side system ID and port information.',all('active','passive'),'Gi0/1  partner SW2, sync true\nGi0/2  partner SW2, sync true','No LACP neighbor.'),
      read('show pagp neighbor','Confirm whether the optional PAgP group found a peer.','No PAgP neighbor on group 31. Compare auto/desirable on the other side.'),
      read('show etherchannel load-balance','Read the configured hash basis.','EtherChannel Load-Balancing Configuration:\n  src-dst-ip')
    ]),
    exec('SW3',[read('show interfaces Port-channel7','Verify addressing and protocol status on the logical bundle.','Port-channel7 is up, line protocol is up\n  Internet address is 192.0.2.81/30')])
  ]),

  lesson({
    id:'rapid-stp-guards',title:'Rapid PVST+, root placement and protection',topics:{encor:['1.1.b','3.1.c'],enarsi:[]},portable:[2],guide:[2,3],
    topology:['SW1 · Distribution primary','SW2 · Distribution backup','SW3 · Access · redundant link'],
    task:'Control per-VLAN root selection and distinguish an alternate port from a port blocked by a guard. Protect edge and upstream-facing links appropriately.'
  }, [
    config('SW1',[
      toggle('spanning-tree mode rapid-pvst','Select Rapid PVST+ with a distinct instance per VLAN.','rapid'),
      ['spanning-tree vlan 72 root primary','Lower the priority on the intended root.'],
      toggle('spanning-tree vlan 72 priority 4096','Set a deterministic primary priority for the lab.','root'),
      ['spanning-tree vlan 72 hello-time 2','Practice the per-VLAN hello interval knob.'],
      ['spanning-tree vlan 72 max-age 20','Set the protocol maximum age.'],
      ['spanning-tree vlan 72 forward-time 15','Set the bridge forward-delay parameter.'],
      ['spanning-tree portfast default','Enable PortFast by default on eligible nontrunk ports.'],
      ['spanning-tree portfast bpduguard default','Protect the PortFast edge on receipt of BPDUs.'],
      ['errdisable recovery cause bpduguard','Allow timed recovery of BPDU Guard errors in the lab.'],
      ['errdisable recovery interval 180','Choose a three-minute recovery timer.']
    ]),
    config('SW2',[['spanning-tree vlan 72 root secondary','Make the second distribution switch the preferred backup root.']]),
    c('SW3',['interface GigabitEthernet0/1'],[
      ['spanning-tree vlan 72 cost 8','Make the chosen root path cheaper.'],
      ['spanning-tree vlan 72 port-priority 64','Influence a tie at the sender port-ID step.'],
      ['spanning-tree link-type point-to-point','Allow rapid proposal/agreement on a full-duplex point-to-point link.'],
      ['spanning-tree guard loop','Prevent a blocked port from forwarding if expected BPDUs stop.'],
      ['udld port aggressive','Use UDLD on the participating point-to-point link.']
    ]),
    c('SW1',['interface GigabitEthernet0/3'],[
      toggle('spanning-tree guard root','Keep a downstream superior BPDU from changing the root location.','guard')
    ]),
    c('SW3',['interface GigabitEthernet0/7'],[
      ['spanning-tree portfast','Treat a user-only link as an edge port.'],
      ['spanning-tree bpduguard enable','Err-disable this port if a BPDU arrives.']
    ]),
    c('SW3',['interface GigabitEthernet0/8'],[
      ['spanning-tree bpdufilter disable','Ensure BPDU transmission and reception are not filtered on this port.']
    ]),
    exec('SW1',[
      observe('show spanning-tree vlan 72','Inspect root ID, port roles and extended system ID.',all('rapid','root'),
        'VLAN0072  RSTP\nRoot ID Priority 4168; this bridge is the root\nGi0/1 Desg FWD\nGi0/3 Desg FWD','The intended priority or mode is missing.'),
      observe('show spanning-tree inconsistentports','Observe the downstream root-inconsistent condition when a superior BPDU appears.','guard',
        'VLAN0072  Gi0/3  Root Inconsistent','No inconsistent ports.'),
      read('show spanning-tree summary','Review active protocol, feature defaults and instance counts.','Switch is in rapid-pvst mode\nPortFast Default is enabled\nBPDU Guard Default is enabled'),
      read('show errdisable recovery','Check the enabled causes and recovery interval.','bpduguard  Enabled\nTimer interval: 180 seconds')
    ]),
    exec('SW3',[
      read('show spanning-tree interface GigabitEthernet0/1 detail','Check the root role and the expected BPDU direction.','Gi0/1 is root forwarding for VLAN0072\nPath cost 8, priority 64, P2p'),
      read('show udld interface GigabitEthernet0/1','Verify the UDLD-connected interfaces are bidirectional.','Port Gi0/1\nAdministrative mode: aggressive\nCurrent bidirectional state: bidirectional'),
      read('show interfaces status err-disabled','Separate err-disabled from the protocol’s blocking state.','Gi0/7  err-disabled  bpduguard')
    ])
  ]),

  lesson({
    id:'mst-region',title:'MST region mapping and mismatch repair',topics:{encor:['3.1.c'],enarsi:[]},portable:[2],guide:[4],
    topology:['SW1 · MST instance 1 root','SW2 · MST instance 2 root'],
    task:'Align the region name, revision, and VLAN-to-instance table. Verify the port stops behaving as a boundary after the mismatch is fixed.'
  }, [
    config('SW1',[['spanning-tree mode mst','Switch to Multiple Spanning Tree.']]),
    c('SW1',['spanning-tree mst configuration'],[
      ['name CAMPUS-WEST','Set a common region name.'],
      ['revision 27','Set the intended region revision.'],
      ['instance 1 vlan 72,84','Map business and voice VLANs to MST instance 1.'],
      toggle('instance 2 vlan 101-110','Group another VLAN range into instance 2.','map1')
    ]),
    config('SW1',[
      ['spanning-tree mst 1 root primary','Make this switch the primary for MST instance 1.'],
      ['spanning-tree mst 2 priority 28672','Make the local switch a backup for instance 2.']
    ]),
    config('SW2',[['spanning-tree mode mst','Enable the same STP mode on the neighbor.']]),
    c('SW2',['spanning-tree mst configuration'],[
      ['name CAMPUS-WEST','Match the region name.'],
      ['revision 27','Match the revision exactly on both switches.'],
      ['instance 1 vlan 72,84','Match the first mapping.'],
      toggle('instance 2 vlan 101-109','Reproduce the planned mapping mismatch safely in this scenario.','map2',false)
    ]),
    exec('SW2',[
      observe('show spanning-tree mst interface GigabitEthernet0/1','Look for the boundary indicator while the region digests differ.',all('map1','map2'),
        'Gi0/1  MST1 Root FWD  P2p (internal)','Gi0/1  MST0 Root FWD  P2p Bound(RSTP)')
    ]),
    c('SW2',['spanning-tree mst configuration'],[
      toggle('instance 2 vlan 101-110','Add the missing VLAN to match the other switch’s map.','map2')
    ]),
    config('SW2',[['spanning-tree mst 2 root primary','Become the root for the second instance.']]),
    exec('SW2',[
      observe('show spanning-tree mst configuration','Verify name, revision and membership for each MST instance.',all('map1','map2'),
        'Name [CAMPUS-WEST]\nRevision 27\n1  72,84\n2  101-110','Instance 2 does not match the neighbor.'),
      observe('show spanning-tree mst interface GigabitEthernet0/1','Confirm the link is internal once the regions agree.',all('map1','map2'),
        'Gi0/1  MST1 Root FWD  P2p (internal)','Gi0/1  MST0 Root FWD  P2p Bound(RSTP)'),
      read('show spanning-tree mst 2','Check the bridge ID and path state for instance 2.','MST2 · VLANs mapped: 101-110\nRoot this switch · Gi0/1 Desg FWD')
    ])
  ]),

  lesson({
    id:'l3-campus-dual-stack',title:'SVIs, router-on-a-stick and routed uplinks',topics:{encor:['1.1.a','3.1.a','3.2.b'],enarsi:['1.1','4.4']},portable:[3],guide:[1,5,6],
    topology:['PC1 · Dual-stack users','SW1 · Campus L3 switch','R1 · 802.1Q router'],
    task:'Route between VLANs using a multilayer switch, compare the subinterface approach, and verify the IPv4 and IPv6 forwarding entries.'
  }, [
    config('SW1',[
      ['ip routing','Enable Layer 3 forwarding on the switch.'],
      ['ipv6 unicast-routing','Enable IPv6 switching between routed interfaces.']
    ]),
    c('SW1',['vlan 72'],[['name USERS','Create the user broadcast domain.']]),
    c('SW1',['interface Vlan72'],[
      toggle('ip address 10.72.0.1 255.255.255.0','Set the IPv4 gateway on the SVI.','svi'),
      ['ipv6 address 2001:db8:72::1/64','Provide the IPv6 gateway address.'],
      ['ip helper-address 192.0.2.83','Relay client DHCP broadcasts to a routed server address.'],
      ['no shutdown','Enable the SVI and verify it has an eligible active VLAN member.']
    ]),
    c('SW1',['interface GigabitEthernet0/8'],[
      ['no switchport','Convert the Layer 2 uplink to a routed interface.'],
      toggle('ip address 192.0.2.82 255.255.255.252','Address the routed point-to-point link.','uplink'),
      ['ipv6 address 2001:db8:7208::2/64','Address the IPv6 side of the uplink.']
    ]),
    c('R1',['interface GigabitEthernet0/1.84'],[
      ['encapsulation dot1q 84','Use VLAN 84 on the tagged subinterface.'],
      ['ip address 10.84.0.1 255.255.255.0','Set the router-on-a-stick IPv4 gateway.'],
      ['ipv6 address 2001:db8:84::1/64','Set the dual-stack IPv6 gateway.']
    ]),
    exec('SW1',[
      observe('show ip interface brief','Verify the active SVI and the new routed interface.',all('svi','uplink'),
        'Vlan72       10.72.0.1    up  up\nGi0/8        192.0.2.82   up  up','Check SVI and uplink status.'),
      read('show ipv6 interface brief','Check where prefixes and link-local addresses are attached.','Vlan72 [up/up]\n  FE80::72\n  2001:DB8:72::1\nGi0/8 [up/up]\n  2001:DB8:7208::2'),
      observe('show ip route connected','Verify the directly connected subnets were installed.',all('svi','uplink'),
        'C 10.72.0.0/24 is directly connected, Vlan72\nC 192.0.2.80/30 is directly connected, Gi0/8','No connected user route.'),
      read('show interfaces Vlan72','Check the relationship between SVI and backing VLAN.','Vlan72 is up, line protocol is up\n  Internet address is 10.72.0.1/24')
    ]),
    exec('R1',[read('show vlans','Confirm tag and subinterface mapping.','Virtual LAN ID: 84 (IEEE 802.1Q)\n  GigabitEthernet0/1.84')])
  ]),

  lesson({
    id:'fhrp-tracking',title:'HSRP, VRRP and tracked gateway failover',topics:{encor:['1.1.b','3.3.c'],enarsi:['4.5']},portable:[8],guide:[15,22],
    topology:['R1 · Preferred gateway','R2 · Standby gateway','PC1 · Stable first-hop IP'],
    task:'Configure a stable gateway, connect it to a track object, and verify the standby takes over when the preferred uplink fails. Compare HSRP and VRRP displays.'
  }, [
    c('R1',['track 72 interface GigabitEthernet0/1 line-protocol'],[
      ['delay down 5 up 10','Wait for a stable link-state change before changing gateway preference.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['standby version 2','Enable the HSRPv2 packet format and group range.'],
      toggle('standby 72 ip 10.72.0.254','Set the stable IPv4 gateway offered to users.','vip'),
      ['standby 72 priority 120','Prefer R1 while its uplink is healthy.'],
      ['standby 72 preempt delay minimum 20','Allow the preferred router to reclaim the active role after a delay.'],
      toggle('standby 72 track 72 decrement 40','Drop R1 below the standby priority after uplink failure.','tracking'),
      ['standby 72 timers 1 3','Use compatible HSRP hello and hold times on both sides.'],
      ['standby 72 authentication md5 key-string NetraGateway72','Protect HSRP control exchanges with the shared lab setting.'],
      ['standby 172 ipv6 autoconfig','Practice an IPv6 HSRPv2 virtual link-local address.']
    ]),
    c('R2',['interface GigabitEthernet0/0'],[
      ['standby version 2','Use the same HSRP version.'],
      toggle('standby 72 ip 10.72.0.254','Match the virtual IPv4 gateway.','peer'),
      ['standby 72 priority 100','Use the backup priority below the healthy R1 priority.'],
      ['standby 72 preempt','Allow this router to become active when it has the greater priority.'],
      ['standby 72 timers 1 3','Align the neighbor timers.'],
      ['standby 72 authentication md5 key-string NetraGateway72','Match peer authentication in this example.']
    ]),
    c('R2',['interface GigabitEthernet0/2'],[
      ['vrrp 22 ip 10.82.0.254','Configure a separate legacy VRRPv2 example.'],
      ['vrrp 22 priority 115','Prefer this router for the VRRP virtual address.'],
      ['vrrp 22 preempt delay minimum 15','Delay a preferred backup’s takeover.'],
      ['vrrp 22 track 72 decrement 30','Reduce priority based on the tracked uplink.']
    ]),
    exec('R1',[
      observe('show standby brief','Read the current active/standby roles.',s=>all('vip','tracking','peer')(s)&&!s.down,
        'Gi0/0  72  120  P  Active   local      10.72.0.2  10.72.0.254',s=>s.down?'Gi0/0  72  80  P  Standby  10.72.0.2  local  10.72.0.254':'HSRP is incomplete.'),
      read('show standby GigabitEthernet0/0','Inspect priority, timing, preempt and tracking configuration.','Group 72 (version 2)\nVirtual IP address is 10.72.0.254\nPriority configured 120; track 72 decrement 40')
    ]),
    c('R1',['interface GigabitEthernet0/1'],[toggle('shutdown','Simulate the tracked uplink failing.','down')]),
    exec('R1',[
      observe('show standby brief','Verify R2 has taken over and the virtual IP stayed stable.',s=>all('vip','tracking','peer')(s)&&!s.down,
        'Gi0/0  72  120  P  Active   local      10.72.0.2  10.72.0.254',s=>s.down?'Gi0/0  72  80  P  Standby  10.72.0.2  local  10.72.0.254':'HSRP is incomplete.')
    ]),
    exec('R2',[
      read('show vrrp brief','Compare VRRP state terminology with HSRP.','Interface   Grp  Pri  Time  Own  Pre  State   Master addr  Group addr\nGi0/2       22   115  3.55       Y    Master  10.82.0.2    10.82.0.254')
    ]),
    shell('PC1',[observe('ping -c 3 10.72.0.254','Check that clients retain the same next-hop address during failover.',all('vip','peer'),
      '3 packets transmitted, 3 received; virtual gateway unchanged','3 packets transmitted, 0 received')])
  ]),

  lesson({
    id:'nat-dhcp-dual-stack',title:'NAT/PAT, DHCPv4 relay and DHCPv6',topics:{encor:['3.3.b'],enarsi:['4.4']},portable:[8],guide:[15],
    topology:['PC1 · Branch clients','R1 · Relay and translation edge','R2 · Simulated IOS DHCP service'],
    task:'Relay an IPv4 or IPv6 client request, retain the correct pool options, and inspect overloaded IPv4 translations. The router at R2 supplies the lab’s service responses.'
  }, [
    c('R2',['ip dhcp pool USERS-72'],[
      toggle('network 10.72.14.0 255.255.255.0','Match the relay’s subnet for pool selection.','pool4'),
      ['default-router 10.72.14.1','Supply the local gateway option.'],
      ['dns-server 192.0.2.93 192.0.2.94','Return the specified DNS option values.'],
      ['domain-name campus.example','Set the lab search suffix.'],
      ['option 150 ip 192.0.2.95','Provide a lab TFTP option for supported phones.'],
      ['lease 1 0 0','Set the lease duration.']
    ]),
    config('R2',[
      ['ip dhcp excluded-address 10.72.14.1 10.72.14.20','Reserve infrastructure addresses.'],
      ['service dhcp','Enable Cisco IOS DHCP server and relay services.']
    ]),
    c('R2',['ipv6 dhcp pool USERS6'],[
      toggle('address prefix 2001:db8:7214::/64 lifetime 86400 43200','Configure a stateful IA_NA address prefix and lifetimes.','pool6'),
      ['dns-server 2001:db8:9300::53','Return the DNS server option.'],
      ['domain-name campus.example','Return the lab search domain.'],
      ['prefix-delegation pool BRANCH-PD lifetime 86400 43200','Reference the lab prefix pool for delegated networks.']
    ]),
    config('R2',[
      ['ipv6 local pool BRANCH-PD 2001:db8:7200::/40 56','Make /56s available for downstream prefix delegation.']
    ]),
    c('R2',['interface GigabitEthernet0/0'],[
      ['ipv6 dhcp server USERS6','Bind the stateful DHCPv6 pool to the lab server link.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      toggle('ip helper-address 192.0.2.92','Relay DHCPv4 broadcasts toward R2.','relay4'),
      ['ipv6 nd managed-config-flag','Signal stateful DHCPv6 address assignment to clients.'],
      ['ipv6 nd other-config-flag','Indicate that other information is available using DHCPv6.'],
      toggle('ipv6 dhcp relay destination 2001:db8:9200::2 GigabitEthernet0/1','Set an explicit DHCPv6 server destination and egress.','relay6'),
      toggle('ip nat inside','Mark the client-facing side for IPv4 translation.','inside')
    ]),
    c('R1',['interface GigabitEthernet0/1'],[
      toggle('ip nat outside','Mark the external IPv4 interface.','outside'),
      ['ipv6 address dhcp','Practice DHCPv6 client configuration on an upstream interface.']
    ]),
    c('R1',['interface GigabitEthernet0/2'],[
      ['ip address dhcp','Acquire IPv4 interface settings using DHCP.']
    ]),
    config('R1',[
      ['ip dhcp relay information option','Include relay-agent information in forwarded DHCPv4 messages.'],
      ['access-list 14 permit 10.72.14.0 0.0.0.255','Select inside sources for translation.'],
      ['ip nat inside source static 10.72.14.8 198.51.100.98','Create a fixed inside-local to inside-global mapping.'],
      ['ip nat pool BRANCH-NAT 198.51.100.101 198.51.100.106 netmask 255.255.255.248','Configure an address pool contained in its subnet.'],
      ['ip nat inside source list 14 pool BRANCH-NAT','Practice a pool-based dynamic mapping before moving to PAT.'],
      ['no ip nat inside source list 14 pool BRANCH-NAT','Remove the pool rule when replacing it with interface PAT.'],
      toggle('ip nat inside source list 14 interface GigabitEthernet0/1 overload','Translate multiple clients using the outside address and transport identifiers.','pat')
    ]),
    shell('PC1',[
      ['ipconfig /renew','Ask for a DHCPv4 lease through the relay.',s=>{s.lease4=all('pool4','relay4')(s);},s=>s.lease4?'IPv4 address: 10.72.14.21; gateway: 10.72.14.1':'No IPv4 DHCP offer received.'],
      ['ipconfig /renew6','Ask for a DHCPv6 lease.',s=>{s.lease6=all('pool6','relay6')(s);},s=>s.lease6?'IPv6 address: 2001:db8:7214::21':'No DHCPv6 reply received.'],
      ['ping 203.0.113.9','Generate a synthetic translated IPv4 flow.',s=>{s.translated=all('lease4','inside','outside','pat')(s);},s=>s.translated?'Reply from 203.0.113.9':'Request timed out.']
    ]),
    exec('R2',[
      observe('show ip dhcp binding','Verify the selected IPv4 lease from the server’s table.','lease4','10.72.14.21   0102.0072.1400.21   Automatic','No IPv4 DHCP leases.'),
      read('show ip dhcp pool USERS-72','Check pool subnet, available addresses and leased state.','Pool USERS-72\nSubnet 10.72.14.0/24; first usable dynamic address 10.72.14.21'),
      observe('show ipv6 dhcp binding','Verify the stateful DHCPv6 lease.','lease6','Client DUID: 00030001020072140021\nIA_NA address: 2001:DB8:7214::21','No IPv6 DHCP bindings.')
    ]),
    exec('R1',[
      observe('show ip nat translations verbose','Inspect the active overloaded mapping.','translated',
        'icmp  198.51.100.97:481  10.72.14.21:481  203.0.113.9:481  203.0.113.9:481','No dynamic translations.'),
      observe('show ip nat statistics','Check inbound and outbound roles and translation counts.',all('inside','outside','pat'),
        s=>'Inside: Gi0/0 · Outside: Gi0/1\nDynamic translations: '+Number(Boolean(s.translated)),'Check interface roles and match rule.'),
      ['clear ip nat translation *','Clear dynamic translations in the simulated edge.',assign({translated:false}),()=> 'Dynamic entries cleared.'],
      read('show dhcp lease','Read the local interface’s client lease context.','Gi0/2  DHCP client enabled; inspect lease and server reachability on this link.'),
      read('show ipv6 dhcp interface GigabitEthernet0/0','Verify the client-facing DHCPv6 relay state.','Gi0/0 is in relay mode\n  Relay destination 2001:DB8:9200::2 via Gi0/1')
    ])
  ])
];
