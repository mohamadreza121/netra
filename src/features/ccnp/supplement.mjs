import { lesson, configure, config, exec, shell, toggle, observe, read, all, assign } from './lesson.mjs';
const c=configure;

export const supplements = [
  lesson({
    id:'wireless-controller-ap',title:'Wireless client and AP troubleshooting',topics:{encor:['extra.wlan'],enarsi:[]},portable:[12],guide:[17,18,19,20,21],
    topology:['PC1 · Wireless client','AP1 · CAPWAP CLI fixture','AP2 · Catalyst 9800 controller CLI fixture'],
    task:'Follow CAPWAP join state, SSID and policy mapping, then troubleshoot a failed client association. The controller commands use a guided console fixture.'
  }, [
    exec('AP1',[
      read('show capwap client config','Read the AP’s configured controller address and join parameters.','Primary controller 192.0.2.230\nAP mode Local\nCAPWAP control UDP 5246'),
      read('show capwap client rcb','Inspect CAPWAP join, configuration and run states.','CAPWAP State: Run · Controller 192.0.2.230'),
      read('show interfaces dot11Radio 0','Inspect the first radio’s operational state on the compatible lab AP.','Radio 0 up · band 2.4 GHz · channel 6')
    ]),
    c('AP2',['wlan CORP-STAFF 72 CORP-STAFF'],[
      ['security wpa wpa2 ciphers aes','Select the WPA2 AES cipher suite for the lab WLAN.'],
      ['security wpa akm dot1x','Enable enterprise dot1x authentication.'],
      ['security dot1x authentication-list WLAN-RADIUS','Attach the existing simulated AAA method.'],
      toggle('no shutdown','Enable the WLAN profile.','wlanReady')
    ]),
    c('AP2',['wireless profile policy STAFF-POLICY'],[
      toggle('vlan 72','Map clients to the STAFF VLAN.','wlanVlan'),
      ['no shutdown','Enable the policy profile.']
    ]),
    c('AP2',['wireless tag policy CAMPUS-POLICY'],[
      toggle('wlan CORP-STAFF policy STAFF-POLICY','Associate the WLAN and policy in the AP’s existing tag.','wlanBound')
    ]),
    exec('AP2',[
      observe('show wlan summary','Verify the configured WLAN is enabled.','wlanReady','72  CORP-STAFF   CORP-STAFF   Enabled   WPA2/802.1X','No active staff WLAN.'),
      observe('show wireless tag policy detailed CAMPUS-POLICY','Check the exact WLAN/profile mapping that reaches the AP.',all('wlanReady','wlanVlan','wlanBound'),
        'CAMPUS-POLICY\nCORP-STAFF  STAFF-POLICY  VLAN 72','Policy-tag mapping incomplete.'),
      read('show ap summary','Find the registered AP and confirm the expected mode.','AP1  Registered  Local  192.0.2.229'),
      read('show ap tag summary','Check the policy, site and RF tags for the selected AP.','AP1   CAMPUS-POLICY   default-site-tag   default-rf-tag')
    ]),
    shell('PC1',[
      ['wpa_cli reassociate','Trigger the configured test client association.',s=>{s.wlanClient=all('wlanReady','wlanVlan','wlanBound')(s);},()=> 'OK'],
      observe('wpa_cli status','Inspect authentication completion from the client side.','wlanClient',
        'wpa_state=COMPLETED\nssid=CORP-STAFF\nkey_mgmt=WPA2-EAP\nip_address=10.72.0.42','wpa_state=DISCONNECTED')
    ]),
    exec('AP2',[
      observe('show wireless client summary','Verify the authorized client connected to the expected AP and WLAN.','wlanClient',
        '0200.0072.0042   AP1   WLAN 72   10.72.0.42  Run','No authorized clients.'),
      observe('show wireless client mac-address 0200.0072.0042 detail','Inspect authentication, policy and assigned VLAN.','wlanClient',
        'Client State: Associated\nPolicy Profile: STAFF-POLICY\nVLAN 72\nAuthorization: Success','Client not found.')
    ])
  ]),

  lesson({
    id:'ospf-tshoot-extra',title:'OSPF NBMA, authentication and LSDB checks',topics:{encor:['3.2.b'],enarsi:['1.10.b','1.10.c.i','1.10.d']},portable:[5],guide:[8,9,10],
    topology:['R1 · Multipoint link','R2 · Statically configured OSPF neighbor'],
    task:'Practice manual OSPF neighbor configuration, authentication, and LSDB troubleshooting on a link without broadcast discovery.'
  }, [
    c('R1',['key chain OSPF-EDGE','key 16'],[
      ['key-string NetraOspfEdge16','Set the shared lab key.'],
      ['cryptographic-algorithm hmac-sha-256','Choose the same key-chain digest on both peers.']
    ]),
    c('R1',['router ospf 89'],[
      toggle('neighbor 192.0.2.234','Define a reachable neighbor for nonbroadcast discovery.','nbmaPeer'),
      ['area 0 authentication','Practice the area-level simple authentication selector for legacy configurations.'],
      ['no area 0 authentication','Remove the lab’s legacy requirement before per-interface key-chain authentication.'],
      ['distribute-list prefix OSPF-RIB-FILTER in','Exercise a local RIB filter on a configured prefix list.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['ip ospf 89 area 0','Activate OSPF on the interface directly.'],
      toggle('ip ospf network point-to-multipoint non-broadcast','Use explicit neighbor discovery with point-to-multipoint semantics.','nbmaType'),
      ['ip ospf authentication-key NetraLegacyOnly','Practice the simple-password field on a legacy peer.'],
      toggle('ip ospf authentication key-chain OSPF-EDGE','Override the legacy mode with the modeled key-chain method.','nbmaAuth')
    ]),
    exec('R1',[
      observe('show ip ospf neighbor detail','Verify the authenticated neighbor and its operational timers.',all('nbmaPeer','nbmaType','nbmaAuth'),
        'Neighbor 10.89.0.2, interface address 192.0.2.234\nState is FULL, interface Gi0/0\nNetwork type POINT_TO_MULTIPOINT (Non-Broadcast)','Neighbor is Down. Check discovery, network type and authentication.'),
      read('show ip ospf database router 10.89.0.2','Review the link entry in the router LSA.','Router Link States (Area 0)\nLink State ID 10.89.0.2\nLS Seq Number 0x80000009'),
      read('show ip ospf database network','Check for a Type 2 LSA on a no-DR segment.','No Type 2 LSA for the point-to-multipoint segment.'),
      read('debug ip ospf adj','Read the scenario’s adjacency diagnostic event.','OSPF: Gi0/0 NBMA neighbor 10.89.0.2 moved from LOADING to FULL'),
      read('debug ip ospf hello','Compare hello intervals and authentication context.','OSPF: hello received from 192.0.2.234 on Gi0/0'),
      ['undebug all','Stop diagnostic output.'],
      read('clear ip ospf process','Practice reinitializing the OSPF process in the isolated fixture.','Simulated process restart completed. Neighbor state recalculated.')
    ])
  ]),

  lesson({
    id:'legacy-eigrp-vtp',title:'Legacy EIGRP, DTP and VTP syntax',topics:{encor:['3.1.a','3.1.b','3.1.c','3.2.a'],enarsi:['1.5','1.9.c','1.9.f']},portable:[1,2,4],guide:[2,3,5,7],
    topology:['R1 · Classic IOS EIGRP fixture','SW1 · Legacy trunk and STP fixture'],
    task:'Recognize commands from the older platform examples in the guide. Use the displayed mode and release assumptions when interpreting output.'
  }, [
    c('R1',['router eigrp 87'],[
      ['auto-summary','Practice the historical classful advertisement behavior.'],
      ['no auto-summary','Restore classless behavior and advertise the intended prefixes.'],
      ['distance 100 192.0.2.237 0.0.0.0','Set a neighbor-specific distance in the lab.'],
      ['neighbor 192.0.2.237 GigabitEthernet0/0','Configure a unicast EIGRP neighbor on the local link.'],
      ['traffic-share min across-interfaces','Use the least-cost path when sharing eligible routes.'],
      ['eigrp stub receive-only','Disable advertised routes from this stub variant.']
    ]),
    config('R1',[
      ['ip default-network 203.0.113.0','Recognize the older candidate-default mechanism.']
    ]),
    exec('R1',[
      read('show ip eigrp topology zero-successors','Check for destinations with no installed successor.','No zero-successor routes in the lab.'),
      read('show ip eigrp events','Review the latest protocol transitions.','Peer 192.0.2.237: adjacency formed; connected routes filtered by receive-only.')
    ]),
    config('SW1',[
      ['vtp domain NETRA-CAMPUS','Set a single lab domain.'],
      ['vtp password NetraVtpPractice','Configure the lab domain password.'],
      ['vtp mode server','Enable the server role for this older-domain example.'],
      ['vtp pruning','Enable older-mode domain pruning for eligible VLANs.'],
      ['spanning-tree mode pvst','Use classic PVST+ to inspect legacy enhancements.'],
      ['spanning-tree uplinkfast','Practice a historical access-switch convergence feature.'],
      ['spanning-tree backbonefast','Practice a historical indirect-failure convergence setting.']
    ]),
    c('SW1',['interface GigabitEthernet0/1'],[
      ['switchport trunk encapsulation dot1q','Choose 802.1Q on platforms that offer a trunk-encapsulation selector.'],
      ['switchport mode dynamic desirable','Initiate DTP negotiation with a suitable neighbor.'],
      ['switchport trunk allowed vlan except 100-110','Keep all other VLANs in the allowed set.']
    ]),
    exec('SW1',[
      read('show spanning-tree uplinkfast','Identify the enabled legacy feature setting.','UplinkFast is enabled'),
      read('show interfaces GigabitEthernet0/1 trunk','Confirm trunking and the native VLAN on the port.','Gi0/1  desirable  802.1q  trunking  1'),
      read('show vtp password','Recognize where older IOS displays the configured lab value.','VTP password configured for NETRA-CAMPUS (lab value omitted).'),
      read('show vtp devices','Inspect known device information in the supported VTP example.','Device ID          Role\nNetra-SW1          Server')
    ])
  ]),

  lesson({
    id:'legacy-vpn-network-services',title:'Legacy crypto maps, NAT Virtual Interface and flow export',topics:{encor:['2.2.b','3.3.b','4.2'],enarsi:['2.3.c','4.6']},portable:[8,11,13],guide:[15,16,24],
    topology:['R1 · Legacy IOS edge fixture','R2 · Matched IKEv1 peer'],
    task:'Cover the compatibility commands in the guide for policy-based IPsec, NAT without inside/outside role tags, and classical NetFlow.'
  }, [
    c('R1',['crypto isakmp policy 28'],[
      ['encryption aes 256','Set the legacy IKEv1 encryption policy.'],
      ['hash sha256','Match the integrity algorithm on the other fixture.'],
      ['authentication pre-share','Select the shared-key identity method.'],
      ['group 14','Match the Diffie-Hellman group used by the example peer.'],
      ['lifetime 28800','Set the IKEv1 security association lifetime.']
    ]),
    config('R1',[
      ['crypto isakmp key NetraIkev1Lab address 198.51.100.241','Set the example-only matching key for this peer.'],
      ['access-list 140 permit gre host 192.0.2.240 host 198.51.100.241','Define the GRE traffic selector for policy-based protection.']
    ]),
    c('R1',['crypto ipsec transform-set LEGACY-TRANSFORM esp-aes 256 esp-sha-hmac'],[
      ['mode transport','Protect the selected GRE traffic.']
    ]),
    c('R1',['crypto map LEGACY-EDGE 10 ipsec-isakmp'],[
      ['set peer 198.51.100.241','Select the remote tunnel endpoint.'],
      ['set transform-set LEGACY-TRANSFORM','Apply the role-appropriate ESP parameters.'],
      ['set pfs group14','Request a DH exchange for perfect forward secrecy.'],
      toggle('match address 140','Bind the traffic selector ACL to the crypto map.','selector')
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      toggle('crypto map LEGACY-EDGE','Apply the policy to the underlay egress.','cryptoMap'),
      ['ip flow ingress','Enable traditional inbound flow collection on the example interface.']
    ]),
    config('R1',[
      ['ip flow-export destination 192.0.2.242 2055','Configure the mock classic NetFlow collector.'],
      ['ip flow-export version 9','Select the template-driven classic export version.'],
      ['ip flow-export source Loopback0','Use the routed lab loopback address.'],
      ['ip nat source static 10.72.12.42 198.51.100.243','Practice a static mapping in legacy NAT Virtual Interface mode.']
    ]),
    c('R1',['interface GigabitEthernet0/2'],[
      toggle('ip nat enable','Enable the NAT Virtual Interface model on the applicable interface.','nvi')
    ]),
    exec('R1',[
      observe('show crypto isakmp sa','Verify the IKEv1 association entered its established state.',all('selector','cryptoMap'),
        'dst             src          state    status\n198.51.100.241  192.0.2.240  QM_IDLE  ACTIVE','No established IKEv1 SA.'),
      observe('show crypto map','Confirm the selected crypto map, selector and peer.',all('selector','cryptoMap'),
        'Crypto Map LEGACY-EDGE 10 ipsec-isakmp\nPeer 198.51.100.241 · Match ACL 140 · Interface Gi0/0','No applied crypto map.'),
      observe('show ip nat nvi translations','Read static NVI translation state.','nvi','198.51.100.243  <->  10.72.12.42   static','No NVI translations.'),
      read('show ip flow export','Check version, peer, source and exporter counters.','Version 9 flow records\nDestination 192.0.2.242 (2055)\nSource Loopback0'),
      read('show ip cache flow','Use the legacy command to inspect a synthetic cache entry.','SrcIf Gi0/0  SrcIP 10.72.12.42  DstIP 203.0.113.243  Pkts 7')
    ])
  ])
];
