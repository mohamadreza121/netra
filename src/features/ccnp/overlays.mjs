import { lesson, configure, config, exec, toggle, observe, read, all } from './lesson.mjs';
const c=configure;

export const overlays = [
  lesson({
    id:'gre-ipsec',title:'GRE, IKEv2 protection and route-based IPsec',topics:{encor:['2.2.b'],enarsi:['2.3.a','2.3.c']},portable:[13],guide:[16],
    topology:['R1 · West edge · 192.0.2.120','R2 · East edge · 198.51.100.121'],
    task:'Build a GRE overlay over a reachable routed underlay, attach IKEv2/IPsec protection and compare GRE addressing with a route-based VTI.'
  }, [
    c('R1',['interface Tunnel72'],[
      ['ip address 10.77.12.1 255.255.255.252','Address the overlay separately from the outer IP headers.'],
      ['ipv6 address 2001:db8:7712::1/64','Carry IPv6 across the lab GRE overlay.'],
      ['tunnel source 192.0.2.120','Source encapsulation from the reachable underlay IP.'],
      toggle('tunnel destination 198.51.100.121','Set the outer destination to the remote GRE endpoint.','gre1'),
      ['tunnel mode gre ip','Encapsulate over the IPv4 underlay.'],
      ['tunnel key 72','Identify this GRE tunnel when matching keys are used.'],
      ['keepalive 5 3','Detect a failed point-to-point GRE tunnel using keepalives.'],
      ['ip mtu 1400','Leave room for tunnel headers.'],
      ['ip tcp adjust-mss 1360','Advertise a smaller IPv4 TCP MSS on the overlay.']
    ]),
    c('R2',['interface Tunnel72'],[
      ['ip address 10.77.12.2 255.255.255.252','Address the other endpoint of the GRE overlay.'],
      ['ipv6 address 2001:db8:7712::2/64','Complete the IPv6 overlay subnet.'],
      ['tunnel source 198.51.100.121','Match the configured outer destination at R1.'],
      toggle('tunnel destination 192.0.2.120','Return outer traffic to the original source.','gre2'),
      ['tunnel mode gre ip','Match the other endpoint’s encapsulation.'],
      ['tunnel key 72','Match the negotiated lab tunnel key.']
    ]),
    exec('R1',[
      observe('show interfaces Tunnel72','Confirm tunnel source, destination and line protocol.',all('gre1','gre2'),
        'Tunnel72 is up, line protocol is up\n  Tunnel source 192.0.2.120, destination 198.51.100.121\n  Tunnel protocol/transport GRE/IP','Tunnel72 is down. Check underlay and endpoint configuration.'),
      observe('ping 2001:db8:7712::2','Verify that the overlay can carry the IPv6 payload.',all('gre1','gre2'),'!!!!!\nSuccess rate is 100 percent (5/5)','.....\nSuccess rate is 0 percent (0/5)')
    ]),
    c('R1',['crypto ikev2 proposal NETRA-PROP'],[
      ['encryption aes-cbc-256','Select an IKEv2 encryption transform.'],
      ['integrity sha256','Specify the integrity algorithm for the CBC proposal.'],
      ['group 19','Align the Diffie-Hellman group with the remote policy.']
    ]),
    c('R1',['crypto ikev2 policy NETRA-IKE'],[
      ['proposal NETRA-PROP','Attach the proposal to an IKEv2 policy.']
    ]),
    c('R1',['crypto ikev2 keyring NETRA-PEERS','peer EAST'],[
      ['address 198.51.100.121','Select the remote peer address.'],
      ['pre-shared-key NetraTunnelPractice72','Use the lab-only shared key.']
    ]),
    c('R1',['crypto ikev2 profile NETRA-IDENTITY'],[
      ['match identity remote address 198.51.100.121 255.255.255.255','Match the remote IKE identity.'],
      ['authentication remote pre-share','Use the lab’s shared-key authentication method.'],
      ['authentication local pre-share','Match the expected local authentication method.'],
      ['keyring local NETRA-PEERS','Reference the local IKEv2 key ring.']
    ]),
    c('R1',['crypto ipsec transform-set NETRA-ESP esp-aes 256 esp-sha256-hmac'],[
      ['mode transport','Protect GRE while retaining its outer IP header for this scenario.']
    ]),
    c('R1',['crypto ipsec profile NETRA-PROTECT'],[
      ['set transform-set NETRA-ESP','Choose ESP algorithms for IPsec.'],
      toggle('set ikev2-profile NETRA-IDENTITY','Select the IKEv2 peer identities and key.','ike')
    ]),
    c('R1',['interface Tunnel72'],[
      toggle('tunnel protection ipsec profile NETRA-PROTECT','Apply protection to the GRE interface.','protected')
    ]),
    c('R1',['interface Tunnel73'],[
      ['ip address 10.77.13.1 255.255.255.252','Configure a second overlay in the VTI example.'],
      ['tunnel source 192.0.2.120','Select the VTI underlay source.'],
      ['tunnel destination 198.51.100.121','Select the VTI underlay destination.'],
      ['tunnel mode ipsec ipv4','Use an IPv4 route-based IPsec interface.']
    ]),
    exec('R1',[
      observe('show crypto ikev2 sa detail','Verify IKEv2 status against the scenario’s matching peer.',all('gre1','gre2','ike','protected'),
        'Peer 198.51.100.121 · IKEv2 state READY\nEncryption AES-CBC-256, Integrity SHA256, DH group 19','No READY IKEv2 security association.'),
      observe('show crypto ipsec sa','Check that the tunnel selection yields IPsec SAs.',all('gre1','gre2','ike','protected'),
        'interface: Tunnel72\n  local crypto endpt. 192.0.2.120, remote crypto endpt. 198.51.100.121\n  inbound esp sas: active\n  outbound esp sas: active','No active IPsec SAs.'),
      read('show tunnel interface Tunnel73','Inspect the route-based overlay separately.','Tunnel73 · mode IPsec IPv4 · configured; matching profile is required on both endpoints.')
    ])
  ]),

  lesson({
    id:'dmvpn-phase3',title:'DMVPN phase 3 with a single hub',topics:{encor:['2.2.b'],enarsi:['2.3.a','2.3.b','2.3.c','2.3.d','2.3.e']},portable:[13],guide:[16],
    topology:['R1 · Hub · 10.79.0.1','R2 · West spoke · 10.79.0.2','R3 · East spoke · 10.79.0.3'],
    task:'Register two spokes with an NHRP server, then generate traffic and verify that the shortcut changes the data path. The lab starts with a reachable underlay and compatible IPsec profiles.'
  }, [
    exec('R1',[observe('show dmvpn','Inspect registered spokes before and after the overlay configuration.',all('hub','west','east'),
       'Type: Hub, Total NBMA Peers: 2\n192.0.2.132  10.79.0.2  UP  D\n198.51.100.133  10.79.0.3  UP  D','Total NBMA Peers: 0')]),
    c('R1',['interface Tunnel79'],[
      ['ip address 10.79.0.1 255.255.255.0','Give the hub a stable overlay address.'],
      ['tunnel source GigabitEthernet0/0','Bind the tunnel to the addressed underlay interface.'],
      ['tunnel mode gre multipoint','Allow the hub to peer with multiple spoke NBMA addresses.'],
      ['tunnel key 79','Match the same GRE key for this cloud.'],
      ['ip nhrp network-id 79','Enable NHRP for the lab mGRE interface.'],
      ['ip nhrp authentication Netra79','Set the common NHRP authentication string.'],
      ['ip nhrp map multicast dynamic','Replicate supported multicast to dynamically registered spokes.'],
      ['no ip split-horizon eigrp 79','Allow the hub to advertise spoke routes toward other spokes on this interface.'],
      toggle('ip nhrp redirect','Tell a spoke when the original forwarding path can be shortened.','hub'),
      ['tunnel protection ipsec profile DMVPN-PROTECT','Apply the matching prebuilt lab profile.']
    ]),
    c('R2',['interface Tunnel79'],[
      ['ip address 10.79.0.2 255.255.255.0','Set the West spoke overlay address.'],
      ['tunnel source GigabitEthernet0/0','Use the West underlay source.'],
      ['tunnel mode gre multipoint','Allow dynamic spoke-to-spoke GRE endpoints.'],
      ['tunnel key 79','Use the hub’s tunnel key.'],
      ['ip nhrp network-id 79','Activate NHRP on the spoke tunnel.'],
      ['ip nhrp authentication Netra79','Use the scenario’s common NHRP authentication value.'],
      ['ip nhrp map 10.79.0.1 203.0.113.131','Resolve the hub tunnel address to its underlay/NBMA address.'],
      ['ip nhrp map multicast 203.0.113.131','Replicate control multicast toward the hub.'],
      toggle('ip nhrp nhs 10.79.0.1','Register with the next-hop server.','west'),
      toggle('ip nhrp shortcut','Accept phase-3 shortcuts installed from NHRP resolution.','shortcut'),
      ['tunnel protection ipsec profile DMVPN-PROTECT','Protect the overlay with the prebuilt lab profile.']
    ]),
    c('R3',['interface Tunnel79'],[
      ['ip address 10.79.0.3 255.255.255.0','Set the East spoke address.'],
      ['tunnel mode gre multipoint','Enable the multipoint tunnel mode.'],
      ['tunnel source GigabitEthernet0/0','Set the underlay source for the East spoke.'],
      ['tunnel key 79','Match the cloud key.'],
      ['ip nhrp network-id 79','Enable NHRP on the tunnel.'],
      ['ip nhrp authentication Netra79','Match the cloud’s NHRP authentication value.'],
      ['ip nhrp map 10.79.0.1 203.0.113.131','Resolve the hub NBMA destination.'],
      ['ip nhrp map multicast 203.0.113.131','Allow supported multicast toward the hub.'],
      toggle('ip nhrp nhs 10.79.0.1','Register the East spoke dynamically.','east'),
      ['ip nhrp shortcut','Allow East to use phase-3 shortcuts.'],
      ['tunnel protection ipsec profile DMVPN-PROTECT','Use the same supported tunnel protection.']
    ]),
    exec('R1',[
      observe('show dmvpn','Confirm the hub saw two dynamic registrations.',all('hub','west','east'),
        'Type: Hub, Total NBMA Peers: 2\n192.0.2.132  10.79.0.2  UP  D\n198.51.100.133  10.79.0.3  UP  D','Total NBMA Peers: 0'),
      read('show ip nhrp nhs detail','Inspect NHS configuration from the hub perspective.','Hub is the NHS for Tunnel79; no upstream NHS is configured.')
    ]),
    exec('R2',[
      observe('show ip nhrp','Compare the static hub entry to the dynamically resolved spoke entry.',all('hub','west','east'),
        s=>'10.79.0.1 via 203.0.113.131, static'+(s.direct?'\n10.79.0.3 via 198.51.100.133, dynamic':''),
        'No usable NHRP mappings.'),
      ['ping 10.79.0.3 source 10.79.0.2','Send lab traffic so the hub can trigger a shortcut.',
        s=>{s.direct=all('hub','west','east','shortcut')(s);},s=>s.direct?'!!!!!\nNHRP resolution completed for 10.79.0.3':'No usable spoke shortcut. Check the registrations and phase-3 knobs.'],
      observe('show ip nhrp shortcut','Verify an override points directly to the resolved spoke.',all('direct'),
        '10.79.0.3/32 via 10.79.0.3 on Tunnel79\n  NBMA 198.51.100.133; installed','No active shortcut.'),
      observe('show dmvpn detail','Check the static hub and dynamic spoke tunnel associations.','direct',
        '10.79.0.1  UP  S (hub)\n10.79.0.3  UP  D (spoke shortcut)','No dynamic spoke peer.'),
      observe('show crypto session detail','Inspect tunnel protection on the current flow.','direct',
        'Interface: Tunnel79\nPeer: 198.51.100.133\nSession status: UP-ACTIVE','No active direct spoke security association.')
    ])
  ]),

  lesson({
    id:'mpls-l3vpn',title:'MPLS label switching and a Layer 3 VPN',topics:{encor:['2.2.a','2.3.b'],enarsi:['1.7','2.1','2.2']},portable:[13],guide:[1,16],
    topology:['R1 · PE West','R2 · P core','R3 · PE East','R4 · CE'],
    task:'Follow an MPLS transport label and a VPN label through a routed core using a guided service-provider topology.'
  }, [
    config('R1',[['mpls label protocol ldp','Use LDP for transport-label distribution.'],['mpls ldp router-id Loopback0 force','Bind LDP to the reachable PE loopback.']]),
    c('R1',['interface GigabitEthernet0/0'],[toggle('mpls ip','Enable MPLS forwarding and LDP discovery on the core-facing port.','peMpls')]),
    c('R2',['interface GigabitEthernet0/0'],[['mpls ip','Enable the P router’s core ingress.']]),
    c('R2',['interface GigabitEthernet0/1'],[toggle('mpls ip','Enable the P router’s core egress.','coreMpls')]),
    c('R1',['vrf definition LAB-BLUE'],[['rd 65080:30','Create distinct VPNv4 NLRI for overlapping tenant addresses.']]),
    c('R1',['vrf definition LAB-BLUE','address-family ipv4'],[
      ['route-target export 65080:30','Tag exported VPN routes with the tenant route target.'],
      toggle('route-target import 65080:30','Import only matching tenant routes.','rt')
    ]),
    c('R1',['interface GigabitEthernet0/1'],[
      ['vrf forwarding LAB-BLUE','Bind the customer link to the intended VRF.'],
      ['ip address 10.80.30.1 255.255.255.252','Assign the PE interface’s tenant address.']
    ]),
    c('R1',['router bgp 65080'],[
      ['neighbor 10.80.0.3 remote-as 65080','Define the other PE as the MP-iBGP peer.'],
      ['neighbor 10.80.0.3 update-source Loopback0','Use a stable underlay address for PE peering.']
    ]),
    c('R1',['router bgp 65080','address-family vpnv4'],[
      toggle('neighbor 10.80.0.3 activate','Exchange VPNv4 NLRI and VPN labels.','vpnPeer'),
      ['neighbor 10.80.0.3 send-community extended','Transmit route-target extended communities.']
    ]),
    c('R1',['router bgp 65080','address-family ipv4 vrf LAB-BLUE'],[
      ['neighbor 10.80.30.2 remote-as 65083','Configure the CE-facing tenant peering.'],
      ['neighbor 10.80.30.2 activate','Enable peer exchange in the correct tenant AF.']
    ]),
    exec('R1',[
      observe('show mpls ldp neighbor','Confirm the adjacent transport LDP session.',all('peMpls','coreMpls'),
        'Peer LDP Ident: 10.80.0.2:0; Local LDP Ident 10.80.0.1:0\nState: Oper','No operational LDP neighbors.'),
      observe('show mpls forwarding-table','Inspect outgoing labels independently of the VPN routing table.',all('peMpls','coreMpls'),
        'Local  Outgoing  Prefix       Interface  Next Hop\n16031  16043     10.80.0.3/32 Gi0/0      192.0.2.146','No label forwarding entries.'),
      observe('show bgp vpnv4 unicast all 203.0.113.0/24','Check the RD, next hop and VPN label.',all('peMpls','coreMpls','vpnPeer','rt'),
        'Route Distinguisher: 65080:30 (LAB-BLUE)\n*>i 203.0.113.0/24  10.80.0.3\n  Extended Community: RT:65080:30; remote label 17007','No imported VPNv4 prefix.'),
      observe('show ip route vrf LAB-BLUE','Confirm the tenant route was installed.',all('vpnPeer','rt'),'B 203.0.113.0/24 [200/0] via 10.80.0.3','Tenant route absent.')
    ]),
    exec('R2',[
      read('show mpls ldp bindings','Distinguish the local and remote bindings for the PE loopback.','10.80.0.3/32\n  local binding: label 16043\n  remote binding: label imp-null'),
      read('show mpls interfaces','Identify the core interfaces running label distribution.','Gi0/0  IP Yes (ldp)\nGi0/1  IP Yes (ldp)')
    ])
  ]),

  lesson({
    id:'multicast-rpf',title:'Multicast RPF, IGMP and PIM',topics:{encor:['3.3.d','4.1'],enarsi:[]},portable:[],guide:[13],
    topology:['PC1 · Receiver','R1 · Last-hop router','R2 · RP and source path'],
    task:'Verify a receiver join and an RPF neighbor, then compare ASM shared trees and SSM source-specific trees.'
  }, [
    config('R1',[
      toggle('ip multicast-routing','Enable multicast forwarding on the lab router.','mcast'),
      ['ip pim rp-address 10.86.0.2','Define the rendezvous point for ASM groups.'],
      ['ip pim ssm default','Use the standard IPv4 SSM group range.'],
      ['ip pim bidir-enable','Enable support for the bidirectional PIM example.'],
      ['ip msdp peer 192.0.2.150 connect-source Loopback0','Inspect the syntax for MSDP between ASM domains.'],
      ['ip msdp originator-id Loopback0','Select a stable MSDP originator address.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      toggle('ip pim sparse-mode','Enable PIM-SM toward the upstream router.','upstream')
    ]),
    c('R1',['interface GigabitEthernet0/1'],[
      ['ip pim sparse-mode','Enable PIM on the receiver VLAN interface.'],
      ['ip igmp version 3','Allow source-specific membership on the receiver segment.'],
      toggle('ip igmp join-group 239.72.84.10','Request the ASM group locally for the lab test.','join'),
      toggle('ip igmp join-group 232.72.84.10 source 198.51.100.151','Request traffic from one specific source in the SSM group.','ssm')
    ]),
    exec('R1',[
      observe('show ip pim neighbor','Verify the upstream PIM adjacency.',all('mcast','upstream'),'192.0.2.150  GigabitEthernet0/0  v2','No PIM neighbor.'),
      read('show ip pim rp mapping','Check the RP used for ASM and the reserved SSM range.','RP: 10.86.0.2 for ASM groups\n232.0.0.0/8 is source-specific multicast.'),
      observe('show ip igmp groups detail','Read membership by interface and source where applicable.',all('join','ssm'),
        'Gi0/1 239.72.84.10 local member\nGi0/1 232.72.84.10 INCLUDE 198.51.100.151','No complete IGMP membership.'),
      observe('show ip rpf 198.51.100.151','Identify the expected inbound interface based on unicast routing.',all('mcast','upstream'),
        'RPF interface: GigabitEthernet0/0\nRPF neighbor: 192.0.2.150\nRPF route: 198.51.100.0/24','No RPF neighbor.'),
      observe('show ip mroute','Distinguish (*,G) from (S,G) forwarding state.',all('join','ssm','upstream'),
        '(*, 239.72.84.10), RP 10.86.0.2\n  Incoming Gi0/0; outgoing Gi0/1\n(198.51.100.151, 232.72.84.10)\n  Incoming Gi0/0; outgoing Gi0/1','No usable multicast state.'),
      read('show ip msdp summary','Read the interdomain source-discovery session status.','Peer 192.0.2.150   State: Established   SA count: 1')
    ])
  ]),

  lesson({
    id:'vxlan-lisp-inspection',title:'VXLAN, EVPN and LISP verification',topics:{encor:['1.3.a','1.3.b','2.3.a','2.3.b'],enarsi:[]},portable:[],guide:[16,23],
    topology:['SW1 · VTEP and Ethernet fabric CLI','SW2 · Remote VTEP','R1 · LISP edge'],
    task:'Inspect fabric control-plane and data-plane state. Compare a MAC/IP EVPN advertisement, a VNI, and an EID-to-RLOC mapping using existing device consoles.'
  }, [
    c('SW1',['l2vpn evpn instance 72 vlan-based'],[
      ['encapsulation vxlan','Select VXLAN as the EVPN data-plane encapsulation.'],
      ['replication-type ingress','Use ingress replication in this lab.']
    ]),
    c('SW1',['interface nve1'],[
      ['source-interface Loopback0','Use the routed loopback as the VTEP address.'],
      ['host-reachability protocol bgp','Use BGP EVPN for endpoint reachability.'],
      ['no shutdown','Enable the overlay endpoint.']
    ]),
    c('SW1',['interface nve1','member vni 10072'],[
      toggle('ingress-replication protocol bgp','Use the BGP control plane to populate ingress-replication peers.','vni')
    ]),
    c('SW1',['router bgp 65072','address-family l2vpn evpn'],[
      toggle('neighbor 10.72.254.2 activate','Activate the EVPN AF for the existing fabric BGP neighbor.','evpn'),
      ['neighbor 10.72.254.2 send-community both','Exchange route-target extended communities.']
    ]),
    exec('SW1',[
      observe('show nve peers','Find the remote VTEP and its operational status.',all('vni','evpn'),'nve1  10.72.254.2  Up  CP','No operational NVE peers.'),
      observe('show nve vni','Verify the VLAN/VNI context on the overlay.',all('vni','evpn'),'nve1  10072  Up  L2  VLAN 72','No active VNI.'),
      observe('show bgp l2vpn evpn summary','Inspect the EVPN AF independently from IPv4 unicast.',all('vni','evpn'),
        '10.72.254.2  AS 65072  State/PfxRcd 3','No EVPN NLRI received.'),
      observe('show bgp l2vpn evpn route-type 2','Locate the remote endpoint MAC/IP advertisement.',all('vni','evpn'),
        '*>i [2] [48] [0200.0072.00aa] [32] [10.72.0.42] via 10.72.254.2','No MAC/IP advertisements.')
    ]),
    exec('R1',[
      read('show lisp session','Read the control-plane registration with a map server.','Peer 192.0.2.157 · State Up · Role Map-Server'),
      read('show lisp instance-id 72 ipv4 database','Read the locally registered endpoint identifier.','10.72.0.0/24  locator 192.0.2.154  priority 1 weight 100'),
      read('show lisp instance-id 72 ipv4 map-cache','Look up the remote endpoint and its routing locator.','10.82.0.0/24 via map-reply, expires in 23:51:04\n  RLOC 192.0.2.155, state up, priority 1 weight 100')
    ])
  ])
];
