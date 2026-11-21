import { lesson, configure, config, exec, shell, toggle, observe, read, all } from './lesson.mjs';

const c = configure;
const defaultPrefix = '203.0.113.0/24';
const route = (type,next,metric) => type+'  '+defaultPrefix+' ['+metric+'] via '+next+', GigabitEthernet0/0';
const absent = '% Network not in table';

export const routing = [
  lesson({
    id:'ebgp-dual-stack', title:'Dual-stack eBGP at the edge', topics:{encor:['3.2.c'], enarsi:['1.11.a','1.11.b','1.11.c']}, portable:[7], guide:[6,11],
    topology:['R1 · AS 65024 · 192.0.2.1','R2 · AS 4200000042 · 192.0.2.2'],
    task:'Bring up an external BGP session and exchange both IPv4 and IPv6 prefixes. Diagnose why an established session can still carry zero routes.'
  }, [
    exec('R1',[observe('show ip bgp summary','Look for a peer and a received-prefix count.',all('peer4','remote4'),
      'Neighbor        AS          State/PfxRcd\n192.0.2.2       4200000042  1','No IPv4 BGP adjacency.')]),
    c('R1',['router bgp 65024'],[
      ['bgp router-id 10.72.0.1','Use an explicit 32-bit identifier.'],
      ['no bgp default ipv4-unicast','Require explicit IPv4 address-family activation.'],
      ['bgp log-neighbor-changes','Record BGP session transitions.'],
      ['neighbor 192.0.2.2 remote-as 4200000042','Configure the four-byte AS for the IPv4 neighbor.'],
      ['neighbor 192.0.2.2 description TRANSIT-EAST','Label the peer in configuration and status.'],
      ['neighbor 192.0.2.2 timers 15 45','Propose the BGP keepalive and hold intervals.'],
      ['neighbor 2001:db8:24::2 remote-as 4200000042','Define a separate IPv6 transport peer.']
    ]),
    c('R1',['router bgp 65024','address-family ipv4 unicast'],[
      toggle('neighbor 192.0.2.2 activate','Activate IPv4 NLRI exchange with the IPv4 peer.','peer4'),
      ['network 198.51.100.0 mask 255.255.255.0','Originate only if the exact IPv4 prefix is present in the local RIB.']
    ]),
    c('R1',['router bgp 65024','address-family ipv6 unicast'],[
      toggle('neighbor 2001:db8:24::2 activate','Enable IPv6 unicast for the IPv6 peer.','peer6'),
      ['network 2001:db8:2400::/48','Advertise the exact IPv6 aggregate present on this edge.']
    ]),
    c('R2',['router bgp 4200000042'],[
      ['bgp router-id 10.72.0.2','Give the far-side BGP process its unique router ID.'],
      ['neighbor 192.0.2.1 remote-as 65024','Configure the reciprocal IPv4 neighbor.'],
      ['neighbor 2001:db8:24::1 remote-as 65024','Configure the reciprocal IPv6 neighbor.']
    ]),
    c('R2',['router bgp 4200000042','address-family ipv4 unicast'],[
      ['neighbor 192.0.2.1 activate','Enable exchange of IPv4 unicast NLRI.'],
      toggle('network 203.0.113.0 mask 255.255.255.0','Advertise the connected transit test prefix.','remote4')
    ]),
    c('R2',['router bgp 4200000042','address-family ipv6 unicast'],[
      ['neighbor 2001:db8:24::1 activate','Enable exchange of IPv6 unicast NLRI.'],
      toggle('network 2001:db8:2600::/48','Advertise the reachable remote IPv6 prefix.','remote6')
    ]),
    exec('R1',[
      observe('show ip bgp summary','Confirm Established by reading the numeric received-prefix field.',all('peer4','remote4'),
        'Neighbor        AS          State/PfxRcd\n192.0.2.2       4200000042  1','No IPv4 BGP adjacency.'),
      observe('show bgp ipv4 unicast 203.0.113.0/24','Inspect AS path, next hop and validity for the remote route.',all('peer4','remote4'),
        'Paths: (1 available, best #1)\n  4200000042\n    192.0.2.2 valid, external, best','% Network not in table'),
      observe('show bgp ipv6 unicast summary','Check IPv6 activation independently of IPv4.',all('peer6','remote6'),
        'Neighbor           AS           State/PfxRcd\n2001:db8:24::2     4200000042   1','No IPv6 prefixes received.'),
      observe('show bgp ipv6 unicast 2001:db8:2600::/48','Verify the IPv6 next hop and remote AS.',all('peer6','remote6'),
        '*> 2001:db8:2600::/48  2001:db8:24::2  4200000042 i','% Network not in table'),
      observe('show ip route bgp','Confirm BGP installed the IPv4 route in the forwarding RIB.',all('peer4','remote4'),
        route('B','192.0.2.2','20/0'),absent),
      observe('show ipv6 route bgp','Verify the received IPv6 route reached the IPv6 routing table.',all('peer6','remote6'),
        'B   2001:DB8:2600::/48 [20/0]\n     via 2001:DB8:24::2','No IPv6 BGP routes.'),
      observe('show ip bgp neighbors 192.0.2.2','Read session state and the negotiated AF capabilities.',all('peer4','remote4'),
        'BGP neighbor is 192.0.2.2, remote AS 4200000042, external link\nBGP state = Established, hold time is 45, keepalive interval is 15\nAddress family IPv4 Unicast: 1 accepted prefix','BGP state = Idle')
    ])
  ]),

  lesson({
    id:'bgp-path-selection', title:'BGP inbound and outbound policy', topics:{encor:['3.2.c'],enarsi:['1.2','1.11.c','1.11.e']},portable:[6,7],guide:[12],
    topology:['R2 · Provider A · AS 65032','R1 · Dual-homed · AS 65030','R3 · Provider B · AS 65033'],
    task:'Prefer provider B for a single prefix, inspect attributes, and advertise a longer AS path toward provider A. Both upstream sessions start established.'
  }, [
    exec('R1',[observe('show ip bgp 203.0.113.0','Compare the two valid paths before and after the inbound policy.','refreshed',
      '*> 203.0.113.0/24  192.0.2.6  localpref 250  65033 i\n*                  192.0.2.2  localpref 100  65032 i',
      '*> 203.0.113.0/24  192.0.2.2  localpref 100  65032 i\n*                  192.0.2.6  localpref 100  65033 i')]),
    config('R1',[
      toggle('ip prefix-list PREFERRED seq 10 permit 203.0.113.0/24','Match the exact destination prefix.','prefix'),
      ['ip prefix-list MORE-SPECIFIC seq 10 permit 198.51.100.0/24 ge 26 le 28','Match a bounded range of mask lengths.'],
      ['ip as-path access-list 12 permit ^65033$','Match a path containing exactly the adjacent provider AS.'],
      ['ip community-list standard SITE-TAG permit 65030:70','Create a named match for the community used in this lab.'],
      ['ip community-list expanded TRANSIT-TAGS permit ^65030:','Match a family of standard communities by expression.']
    ]),
    c('R1',['route-map PREFER-B permit 10'],[
      toggle('match ip address prefix-list PREFERRED','Limit the higher preference to the intended route.','match'),
      toggle('set local-preference 250','Raise local preference inside the enterprise AS.','localpref'),
      ['set community 65030:70 additive','Attach a marker while preserving existing standard communities.']
    ]),
    c('R1',['route-map PREFER-B permit 20'],[]),
    c('R1',['route-map ADVERTISE-A permit 10'],[
      ['match as-path 12','Match only the selected ingress AS path.'],
      ['set as-path prepend 65030 65030','Make the outbound path through A look longer to the remote decision process.'],
      ['set metric 120','Set the advertised MED for the matching announcement.'],
      ['set community no-export additive','Mark the route to restrict onward eBGP propagation.']
    ]),
    c('R1',['route-map ADVERTISE-A permit 20'],[]),
    c('R1',['router bgp 65030','address-family ipv4 unicast'],[
      toggle('neighbor 192.0.2.6 route-map PREFER-B in','Attach the policy to updates received from provider B.','policy'),
      ['neighbor 192.0.2.2 route-map ADVERTISE-A out','Attach the outbound attribute modification.'],
      ['neighbor 192.0.2.2 send-community','Send the standard community attribute to this peer.'],
      ['neighbor 192.0.2.2 remove-private-as','Remove eligible private ASNs in outbound updates on the selected edge.'],
      ['neighbor 192.0.2.6 prefix-list MORE-SPECIFIC out','Filter outbound NLRI using a prefix list.'],
      ['neighbor 192.0.2.6 filter-list 12 in','Apply the AS-path filter in the inbound direction.'],
      ['neighbor 192.0.2.2 weight 0','Keep the other provider at equal weight for the local-preference comparison.']
    ]),
    exec('R1',[
      ['clear ip bgp 192.0.2.6 soft in','Reapply inbound policy with route refresh. Keep the session up.',
        state=>{state.refreshed=all('policy','prefix','match','localpref')(state);},state=>state.refreshed?'Inbound route refresh complete.':'Inbound policy is incomplete.'],
      read('show ip prefix-list PREFERRED','Check the active prefix predicate.','ip prefix-list PREFERRED: 1 entries\n  seq 10 permit 203.0.113.0/24'),
      read('show ip as-path-access-list','Inspect the anchored AS-path expression.','AS path access list 12\n  permit ^65033$'),
      read('show route-map PREFER-B','Verify sequence order and the catch-all permit.','route-map PREFER-B, permit, sequence 10\n  Match: ip address prefix-lists PREFERRED\n  Set: local-preference 250\nroute-map PREFER-B, permit, sequence 20'),
      observe('show ip bgp 203.0.113.0','Confirm that the B path wins for this prefix after the refresh.','refreshed',
        '*> 203.0.113.0/24  192.0.2.6  localpref 250  65033 i\n*                  192.0.2.2  localpref 100  65032 i',
        '*> 203.0.113.0/24  192.0.2.2  localpref 100  65032 i\n*                  192.0.2.6  localpref 100  65033 i'),
      observe('show ip bgp neighbors 192.0.2.6 routes','Show routes accepted from B after the inbound filters.',all('policy','prefix'),
        '*> 203.0.113.0/24  192.0.2.6  65033 i','No matching routes.'),
      read('show ip bgp neighbors 192.0.2.2 advertised-routes','Check which local prefixes are presented to A.','*> 198.51.100.0/24   0.0.0.0   i'),
      read('show bgp ipv4 unicast regexp ^65033$','Find routes whose AS path is exactly 65033.','*> 203.0.113.0/24   192.0.2.6   65033 i')
    ])
  ]),

  lesson({
    id:'ibgp-reflection',title:'iBGP next hop, peer groups and reflection',topics:{encor:['3.2.c'],enarsi:['1.11.b','1.11.d','1.11.e']},portable:[7],guide:[11,12],
    topology:['R2 · RR client','R1 · Reflector · AS 65040','R3 · RR client', 'R4 · Multihop eBGP'],
    task:'Use loopback-sourced iBGP sessions, reflect an NLRI to a second client, and bring up a password-matched multihop edge peer.'
  },[
    c('R1',['router bgp 65040'],[
      ['bgp router-id 10.73.0.1','Give the reflector a stable router ID.'],
      ['bgp cluster-id 10.73.0.1','Use a stable reflector cluster identifier for loop prevention.'],
      ['neighbor CAMPUS peer-group','Create a shared group for common settings.'],
      ['neighbor CAMPUS remote-as 65040','Assign the internal AS to the group.'],
      ['neighbor CAMPUS update-source Loopback0','Use the reachable loopback as the TCP source.'],
      ['neighbor 10.73.0.2 peer-group CAMPUS','Associate the first client with the group.'],
      ['neighbor 10.73.0.3 peer-group CAMPUS','Associate the second client with the group.'],
      ['neighbor 192.0.2.42 remote-as 65042','Configure the remote edge AS.'],
      toggle('neighbor 192.0.2.42 ebgp-multihop 2','Increase TTL for the non-direct external peer.','multihop'),
      ['neighbor 192.0.2.42 update-source Loopback0','Match the source the external neighbor expects.'],
      toggle('neighbor 192.0.2.42 password NetraEdgeLab24','Configure the same lab authentication string as the remote peer.','auth'),
      ['neighbor 192.0.2.42 fall-over bfd','Request fast neighbor failure detection where supported.']
    ]),
    c('R1',['router bgp 65040','address-family ipv4 unicast'],[
      ['neighbor CAMPUS activate','Enable IPv4 unicast for the peers in this group.'],
      ['neighbor CAMPUS next-hop-self','Normalize next hop for eligible external announcements.'],
      ['neighbor 10.73.0.2 route-reflector-client','Set the first peer as an RR client.'],
      toggle('neighbor 10.73.0.3 route-reflector-client','Allow reflection toward the second client.','reflected'),
      ['neighbor 192.0.2.42 default-originate','Originate a default toward the external neighbor.'],
      ['aggregate-address 203.0.112.0 255.255.254.0 summary-only','Advertise the aggregate and suppress its components for eligible peers.'],
      ['bgp bestpath as-path multipath-relax','Permit BGP multipath across distinct AS paths of qualifying length.'],
      ['maximum-paths 2','Allow two eligible eBGP paths for the same prefix.'],
      ['maximum-paths ibgp 2','Allow two eligible internal next hops for the prefix.']
    ]),
    c('R2',['router bgp 65040'],[
      ['neighbor 10.73.0.1 remote-as 65040','Configure the reflector as the internal neighbor.'],
      ['neighbor 10.73.0.1 update-source Loopback0','Use the loopback as the source.']
    ]),
    c('R2',['router bgp 65040','address-family ipv4 unicast'],[
      toggle('network 198.51.100.0 mask 255.255.255.0','Originate the first client prefix.','clientRoute')
    ]),
    exec('R1',[
      observe('show ip bgp summary','Compare internal and external TCP/BGP state.',all('reflected','multihop','auth','clientRoute'),
        '10.73.0.2      65040  1\n10.73.0.3      65040  0\n192.0.2.42     65042  1','At least one peer is Idle or has no useful NLRI.'),
      read('show ip bgp peer-group CAMPUS','Inspect group membership.','CAMPUS external/internal settings: internal AS 65040\nMembers: 10.73.0.2, 10.73.0.3'),
      observe('show ip bgp neighbors 192.0.2.42','Check multihop reachability, source and authentication.',all('multihop','auth'),
        'BGP state = Established\nConfigured eBGP multihop TTL is 2\nTCP authentication configured','BGP state = Active. Check the underlay and reciprocal password.')
    ]),
    exec('R3',[
      observe('show ip bgp 198.51.100.0','Confirm the route has a reachable next hop and reflection attributes.',all('clientRoute','reflected'),
        '*>i 198.51.100.0/24 via 10.73.0.2\n    Originator: 10.73.0.2, Cluster list: 10.73.0.1',absent)
    ])
  ]),

  lesson({
    id:'ospf-multiarea',title:'Multiarea OSPFv2 and adjacency repair',topics:{encor:['3.2.a','3.2.b'],enarsi:['1.5','1.10.b','1.10.c.i','1.10.c.iii','1.10.d']},portable:[5],guide:[8,9],
    topology:['R1 · Area 0 listener','R2 · ABR','R3 · Area 24 router'],
    task:'Repair a timer mismatch, keep access links passive, and see how the ABR advertises a summary.'
  }, [
    exec('R1',[observe('show ip ospf neighbor','Check whether the backbone adjacency is FULL.',all('area0','timers'),
      'Neighbor ID     Pri   State      Address      Interface\n10.74.0.2        0    FULL/-     192.0.2.10   Gi0/0','No FULL neighbor. The local hello/dead timers are 10/40.')]),
    c('R1',['router ospf 74'],[
      ['router-id 10.74.0.1','Set the identifier used in the link-state database.'],
      toggle('network 192.0.2.8 0.0.0.3 area 0','Enable OSPF on the selected backbone link.','area0'),
      ['passive-interface default','Suppress hellos on all interfaces by default.'],
      ['no passive-interface GigabitEthernet0/0','Allow adjacency formation on the backbone.'],
      ['auto-cost reference-bandwidth 10000','Set the shared 10-Gb/s reference bandwidth.'],
      ['maximum-paths 4','Cap the number of equal-cost OSPF paths.'],
      ['timers throttle spf 50 200 2000','Pace repeated shortest-path calculations.'],
      ['max-lsa 6000','Set a lab LSDB limit on non-self-originated LSAs.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['ip ospf network point-to-point','Align the segment type with the far side.'],
      ['ip ospf hello-interval 5','Use the same hello interval as R2.'],
      toggle('ip ospf dead-interval 20','Align the neighbor expiry interval.','timers'),
      ['ip ospf cost 20','Set the cost used for this link in SPF.'],
      ['ip ospf priority 0','Prevent DR election where a broadcast network type uses this port.'],
      ['ip ospf mtu-ignore','Practice removing the MTU check during adjacency exchange.']
    ]),
    c('R2',['router ospf 74'],[
      ['router-id 10.74.0.2','Use a unique ABR router ID.'],
      ['network 192.0.2.8 0.0.0.3 area 0','Join the backbone on the transit link.'],
      toggle('network 10.74.24.0 0.0.0.255 area 24','Advertise the ABR’s area-24 interface.','area24'),
      toggle('area 24 range 10.74.24.0 255.255.252.0','Summarize the home area at the ABR.','summary'),
      ['area 24 filter-list prefix CAMPUS-OUT out','Filter interarea summary LSAs sent out of area 24.']
    ]),
    config('R2',[
      ['ip prefix-list CAMPUS-OUT seq 5 permit 10.74.24.0/22','Permit the intended area aggregate.'],
      ['ip prefix-list CAMPUS-OUT seq 10 deny 0.0.0.0/0 le 32','Drop other covered outbound interarea advertisements.']
    ]),
    exec('R2',[
      observe('show ip ospf','Verify the ABR role by the presence of both areas.','area24','Routing Process "ospf 74" with ID 10.74.0.2\nIt is an area border router\nArea 0 (Backbone)\nArea 24','Area 0 only.'),
      observe('show ip ospf database summary','Look for the Type 3 summary from the ABR.',all('summary','area24'),'Summary Net Link States (Area 0)\n10.74.24.0   Advertising Router 10.74.0.2   Mask /22','No summary for 10.74.24.0/22.')
    ]),
    exec('R1',[
      observe('show ip ospf neighbor','Verify the timer correction moved the adjacency to FULL.',all('area0','timers'),
        'Neighbor ID     Pri   State      Address      Interface\n10.74.0.2        0    FULL/-     192.0.2.10   Gi0/0','No FULL neighbor. The local hello/dead timers are 10/40.'),
      observe('show ip ospf interface GigabitEthernet0/0','Compare network type, area, timers and cost.',all('area0','timers'),
        'Area 0, Network Type POINT_TO_POINT, Cost: 20\nTimer intervals configured, Hello 5, Dead 20','Check area membership and hello/dead timers.'),
      observe('show ip ospf interface brief','Verify the operational OSPF link.',all('area0','timers'),'Gi0/0  74  0  192.0.2.9/30  20  P2P  1/1','Gi0/0  74  0  192.0.2.9/30  20  P2P  0/0'),
      observe('show ip route ospf','Read the interarea entry installed behind the neighbor.',all('summary','area24','timers'),
        'O IA 10.74.24.0/22 [110/40] via 192.0.2.10','No OSPF interarea routes.'),
      read('show ip protocols','Review active routing process, reference settings and passive interfaces.','Routing Protocol is "ospf 74"\nRouter ID 10.74.0.1\nPassive Interface(s): all except GigabitEthernet0/0')
    ])
  ]),

  lesson({
    id:'ospf-special-areas',title:'OSPF stub areas, NSSA and virtual links',topics:{encor:['3.2.b'],enarsi:['1.3','1.5','1.10.c.ii','1.10.c.iii','1.10.c.iv','1.10.d']},portable:[5,6],guide:[9],
    topology:['R1 · OSPF ABR','R2 · Area 24 branch','R3 · Area 40 NSSA ASBR','R4 · Transit area 50'],
    task:'Reduce the branch LSDB, redistribute a static route in an NSSA, and inspect a virtual backbone adjacency across a normal transit area.'
  }, [
    c('R1',['router ospf 81'],[
      toggle('area 24 stub no-summary','Make the branch totally stubby from the ABR.','stubABR'),
      ['area 24 default-cost 12','Tune the ABR-advertised default metric for area 24.'],
      toggle('area 40 nssa no-summary','Suppress interarea summaries at the NSSA ABR.','nssaABR'),
      ['area 40 nssa translate type7 always','Make the configured NSSA ABR translate eligible Type 7 LSAs.'],
      ['area 50 range 10.81.50.0 255.255.254.0 not-advertise','Suppress the specified interarea range.'],
      toggle('area 50 virtual-link 10.81.0.4','Create a virtual backbone link via a normal transit area.','vlinkA')
    ]),
    c('R2',['router ospf 81'],[
      toggle('area 24 stub','Set the corresponding stub option on the internal router.','stubBranch'),
      ['passive-interface Loopback0','Advertise the loopback without trying to form neighbors on it.']
    ]),
    c('R3',['router ospf 81'],[
      toggle('area 40 nssa','Allow external injection within the NSSA.','nssaSpoke'),
      toggle('redistribute static subnets metric 20 metric-type 1','Import the static prefix as an NSSA external with internal cost added.','external'),
      ['summary-address 198.51.100.0 255.255.255.0 not-advertise','Suppress the selected external summary.'],
      ['default-information originate always','Originate a default in the applicable normal-area OSPF domain even without a local default.']
    ]),
    c('R4',['router ospf 81'],[
      toggle('area 50 virtual-link 10.81.0.1','Configure the other end with R1’s router ID.','vlinkB')
    ]),
    exec('R2',[
      observe('show ip route ospf','A totally stubby branch receives the ABR default.',all('stubABR','stubBranch'),'O*IA 0.0.0.0/0 [110/12] via 10.81.24.1','No ABR default. Check the area type on both ends.'),
      observe('show ip ospf database summary','Only the default Type 3 is expected in this totally stubby area.',all('stubABR','stubBranch'),'Summary Net Link States (Area 24)\n0.0.0.0    ADV Router 10.81.0.1','Area adjacency has not formed.')
    ]),
    exec('R3',[
      observe('show ip ospf database nssa-external','Look for the locally generated Type 7 LSA.',all('nssaABR','nssaSpoke','external'),
        'Type-7 AS External Link States (Area 40)\n203.0.113.0    ADV Router 10.81.0.3    Metric Type 1','No matching Type 7 LSA.')
    ]),
    exec('R1',[
      observe('show ip ospf database external','Verify the eligible Type 7 was translated into a Type 5 outside the NSSA.',all('nssaABR','nssaSpoke','external'),
        'Type-5 AS External Link States\n203.0.113.0    ADV Router 10.81.0.1    Metric Type 1','No matching Type 5 LSA.'),
      observe('show ip ospf virtual-links','Check the virtual-link state and transit area.',all('vlinkA','vlinkB'),
        'Virtual Link OSPF_VL0 to router 10.81.0.4 is up\nTransit area 50, State POINT_TO_POINT','Virtual link is down. Check both endpoints and the transit area.'),
      read('show ip ospf border-routers','Check reachability to ABRs and ASBRs.','i 10.81.0.3 [18] via 10.81.40.3 (ASBR)\ni 10.81.0.4 [25] via 10.81.50.4 (ABR)')
    ])
  ]),

  lesson({
    id:'ospfv3-auth-af',title:'OSPFv3 address families and OSPF authentication',topics:{encor:['3.2.b'],enarsi:['1.10.a','1.10.b','1.10.c.i']},portable:[5],guide:[8,9,10],
    topology:['R1 · Dual-stack','R2 · Dual-stack · Area 0','R3 · Traditional OSPFv3'],
    task:'Configure both OSPFv3 families and the shared authentication key. Compare interface-based OSPFv3 with OSPFv2 authentication diagnostics.'
  }, [
    config('R1',[['ipv6 unicast-routing','Enable IPv6 forwarding before deploying OSPFv3.']]),
    c('R1',['key chain CAMPUS-OSPF','key 12'],[
      ['key-string NetraRoutingLab24','Use the shared lab key on both peers.'],
      toggle('cryptographic-algorithm hmac-sha-256','Select a consistent authentication algorithm.','key1')
    ]),
    c('R1',['router ospfv3 76'],[
      ['router-id 10.76.0.1','Configure the required 32-bit OSPF router ID.']
    ]),
    c('R1',['router ospfv3 76','address-family ipv4 unicast'],[
      ['passive-interface Loopback0','Advertise the IPv4 loopback without neighbor discovery on it.']
    ]),
    c('R1',['router ospfv3 76','address-family ipv6 unicast'],[
      ['area 21 range 2001:db8:7600::/40','Configure a v6 area summary at the ABR.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['ipv6 enable','Enable IPv6 link-local operation for OSPFv3 transport.'],
      ['ospfv3 76 ipv4 area 0','Activate the IPv4 AF on this link.'],
      toggle('ospfv3 76 ipv6 area 0','Activate the IPv6 AF on the same link.','v3af'),
      ['ospfv3 network point-to-point','Set the link network type.'],
      toggle('ospfv3 authentication key-chain CAMPUS-OSPF','Apply the OSPFv3 authentication trailer using the local key chain.','auth1')
    ]),
    config('R2',[['ipv6 unicast-routing','Prepare R2 for IPv6 routing.']]),
    c('R2',['key chain CAMPUS-OSPF','key 12'],[
      ['key-string NetraRoutingLab24','Match the other side’s key.'],
      toggle('cryptographic-algorithm hmac-sha-256','Match the key-chain algorithm.','key2')
    ]),
    c('R2',['router ospfv3 76'],[['router-id 10.76.0.2','Give R2 a distinct OSPF router ID.']]),
    c('R2',['interface GigabitEthernet0/0'],[
      ['ipv6 enable','Bring up IPv6 link-local operation.'],
      ['ospfv3 76 ipv4 area 0','Match the IPv4 AF and area.'],
      ['ospfv3 76 ipv6 area 0','Match the IPv6 AF and area.'],
      ['ospfv3 network point-to-point','Match the neighbor network type.'],
      toggle('ospfv3 authentication key-chain CAMPUS-OSPF','Apply the matching key chain.','auth2')
    ]),
    c('R3',['ipv6 router ospf 77'],[
      ['router-id 10.76.0.3','Configure traditional OSPFv3 for IPv6 only.'],
      ['area 21 stub','Configure area 21 as a stub in this traditional example.']
    ]),
    c('R3',['interface GigabitEthernet0/1'],[
      ['ipv6 ospf 77 area 21','Enable the traditional OSPFv3 process at the link.']
    ]),
    c('R3',['router ospf 78'],[
      ['area 0 authentication message-digest','Require OSPFv2 cryptographic authentication in area 0.']
    ]),
    c('R3',['interface GigabitEthernet0/0'],[
      ['ip ospf message-digest-key 7 md5 NetraV2Lab','Set the same key ID and lab key as the remote OSPFv2 peer.'],
      ['ip ospf authentication message-digest','Select the matching OSPFv2 per-link authentication method.']
    ]),
    exec('R1',[
      observe('show ospfv3 neighbor','Compare neighbors separately for IPv4 and IPv6 AFs.',all('v3af','key1','key2','auth1','auth2'),
        'OSPFv3 76 address-family ipv4\n10.76.0.2     FULL/-    Gi0/0\nOSPFv3 76 address-family ipv6\n10.76.0.2     FULL/-    Gi0/0','No authenticated FULL adjacency.'),
      observe('show ospfv3 interface GigabitEthernet0/0','Verify the bound key chain and area.',all('auth1','auth2'),'Process 76, Area 0, Type POINT_TO_POINT\nAuthentication Trailer enabled, key chain CAMPUS-OSPF','Authentication trailers do not match.'),
      observe('show ipv6 route ospf','Confirm the IPv6 AF installed a remote prefix.',all('v3af','auth1','auth2'),'O   2001:DB8:7620::/64 [110/20] via FE80::2, Gi0/0','No IPv6 OSPF routes.')
    ]),
    exec('R3',[
      read('show ipv6 ospf interface brief','Inspect the interface association in traditional OSPFv3.','Gi0/1  PID 77  Area 21  Cost 10  State P2P'),
      read('show ip ospf interface GigabitEthernet0/0','Inspect the active OSPFv2 authentication type and key ID.','Message digest authentication enabled\n  Youngest key id is 7')
    ])
  ]),

  lesson({
    id:'eigrp-classic',title:'Classic EIGRP adjacency, metric and variance',topics:{encor:['3.2.a'],enarsi:['1.1','1.3','1.5','1.9.b','1.9.c','1.9.d','1.9.e','1.9.f']},portable:[4,6],guide:[6,7],
    topology:['R1 · Primary and feasible paths','R2 · EIGRP 84 peer','R3 · Stub peer'],
    task:'Use a matching key chain and verify that variance installs an eligible unequal-cost path while rejecting a route that fails the feasibility condition.'
  }, [
    c('R1',['key chain CAMPUS-EIGRP','key 4'],[
      toggle('key-string NetraIGP84','Set the shared lab EIGRP key.','eigrpKey')
    ]),
    c('R1',['router eigrp 84'],[
      ['eigrp router-id 10.84.0.1','Set the EIGRP router ID for this process.'],
      ['network 10.84.0.0 0.0.255.255','Enable EIGRP on matching interfaces.'],
      ['no auto-summary','Use classless advertisements.'],
      ['passive-interface default','Stop unnecessary EIGRP hellos on access links.'],
      ['no passive-interface GigabitEthernet0/0','Allow the primary peering.'],
      ['no passive-interface GigabitEthernet0/1','Allow the backup peering.'],
      ['maximum-paths 4','Allow up to four eligible installed paths.'],
      toggle('variance 2','Allow feasible unequal-cost routes within twice the successor metric.','variance'),
      ['traffic-share balanced','Distribute eligible traffic in inverse proportion to the metric.'],
      ['metric weights 0 1 0 1 0 0','Record the default K values for classic EIGRP.'],
      ['distance eigrp 90 170','Set internal and external administrative distances.'],
      ['default-metric 100000 100 255 1 1500','Provide seed metrics for redistribution.'],
      ['redistribute static','Redistribute a static route using the configured seed metric.'],
      ['default-information in','Permit candidate default information where supported.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['bandwidth 100000','Set the bandwidth used by the composite metric.'],
      ['delay 150','Set delay in tens of microseconds.'],
      ['ip hello-interval eigrp 84 5','Set the EIGRP hello timer.'],
      ['ip hold-time eigrp 84 15','Advertise how long peers should keep this neighbor.'],
      ['ip bandwidth-percent eigrp 84 35','Limit EIGRP control bandwidth on the link.'],
      ['ip authentication mode eigrp 84 md5','Enable classic EIGRP MD5 authentication on the link.'],
      toggle('ip authentication key-chain eigrp 84 CAMPUS-EIGRP','Tie the interface to the configured key chain.','authInt'),
      ['ip summary-address eigrp 84 10.84.32.0 255.255.240.0','Advertise an interface-level summary.'],
      ['no ip split-horizon eigrp 84','Permit outbound advertisements learned on the same multipoint link when needed.']
    ]),
    c('R3',['router eigrp 84'],[
      toggle('eigrp stub connected summary','Advertise only eligible connected and summary routes from the stub.','stub')
    ]),
    exec('R1',[
      observe('show ip eigrp neighbors','Confirm authentication and active neighbor state.',all('eigrpKey','authInt'),
        'H  Address     Interface  Hold  Q\n0  10.84.0.2   Gi0/0      14    0\n1  10.84.0.6   Gi0/1      12    0','No authenticated neighbor on Gi0/0.'),
      read('show ip eigrp topology all-links','Compare reported and total distance before deciding which backup is feasible.',
        'P 203.0.113.0/24, 1 successors, FD is 30720\n  via 10.84.0.2 (30720/25600), Gi0/0\n  via 10.84.0.6 (46080/28160), Gi0/1\n  via 10.84.0.10 (51200/40960), Gi0/2'),
      observe('show ip route eigrp','Only feasible paths and the successor can be installed with variance enabled.',all('eigrpKey','authInt','variance'),
        'D 203.0.113.0/24 [90/30720] via 10.84.0.2\n                   [90/46080] via 10.84.0.6','D 203.0.113.0/24 [90/30720] via 10.84.0.2'),
      read('show ip eigrp interfaces detail','Inspect timers, authentication and the interface pacing state.','Gi0/0: Hello interval is 5, Hold time is 15\nAuthentication mode is MD5, key-chain is CAMPUS-EIGRP'),
      read('show ip eigrp traffic','Inspect sent and received control-plane messages.','Hellos sent/received: 24/21\nUpdates sent/received: 3/4\nQueries sent/received: 0/0'),
      read('show ip eigrp topology active','Check whether DUAL still has unanswered queries.','No routes currently Active.'),
      read('debug eigrp packets hello','Observe only neighbor hellos from the scenario.','EIGRP: received HELLO on Gi0/0 from 10.84.0.2'),
      ['undebug all','Clear the active debug filter.',null,()=> 'All debugging has been turned off.']
    ])
  ]),

  lesson({
    id:'eigrp-named-vrf',title:'Named EIGRP in a dual-stack VRF',topics:{encor:['3.2.a','2.2.a'],enarsi:['1.7','1.9.a','1.9.b','1.9.c','1.9.d','1.9.e','1.9.f']},portable:[4,13],guide:[7,16],
    topology:['R1 · VRF BLUE','R2 · Named EIGRP peer','R3 · Classic IPv6 example'],
    task:'Configure IPv4 and IPv6 address families, their interface policies, and the base topology. Separate neighbor state from the global table.'
  }, [
    c('R1',['vrf definition BLUE','address-family ipv4'],[]),
    c('R1',['vrf definition BLUE','address-family ipv6'],[]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['vrf forwarding BLUE','Assign the interface to the VRF before restoring its addresses.'],
      ['ip address 192.0.2.49 255.255.255.252','Address the VRF IPv4 uplink.'],
      ['ipv6 address 2001:db8:84::1/64','Address the IPv6 VRF uplink.']
    ]),
    c('R1',['router eigrp CAMPUS','address-family ipv4 unicast vrf BLUE autonomous-system 85'],[
      ['eigrp router-id 10.85.0.1','Set the named AF router ID.'],
      toggle('network 192.0.2.48 0.0.0.3','Select the IPv4 VRF transit interface.','v4af'),
      ['eigrp stub connected summary','Bound the queries and advertisements of this branch.']
    ]),
    c('R1',['router eigrp CAMPUS','address-family ipv4 unicast vrf BLUE autonomous-system 85','af-interface default'],[
      ['passive-interface','Silence interfaces in this AF by default.']
    ]),
    c('R1',['router eigrp CAMPUS','address-family ipv4 unicast vrf BLUE autonomous-system 85','af-interface GigabitEthernet0/0'],[
      toggle('no passive-interface','Enable the intended VRF peering.','afLink'),
      ['hello-interval 5','Tune the named-mode hello interval.'],
      ['hold-time 15','Tune the named-mode hold time.'],
      ['authentication mode hmac-sha-256 Netra84VRF','Configure the modern named-mode authentication form.'],
      ['summary-address 10.85.32.0 255.255.240.0','Summarize matching routes toward this neighbor.'],
      ['bandwidth-percent 40','Adjust the interface percentage of nominal bandwidth for control traffic.']
    ]),
    c('R1',['router eigrp CAMPUS','address-family ipv4 unicast vrf BLUE autonomous-system 85','topology base'],[
      ['metric rib-scale 128','Scale the 64-bit EIGRP metric when installing into the RIB.'],
      ['maximum-paths 4','Set the EIGRP multipath limit.'],
      ['variance 2','Set the feasible unequal-cost threshold.'],
      ['traffic-share balanced','Use weighted load sharing among installed paths.']
    ]),
    c('R1',['router eigrp CAMPUS','address-family ipv6 unicast vrf BLUE autonomous-system 85'],[
      toggle('eigrp router-id 10.85.0.1','Enable the IPv6 address family with a 32-bit router ID.','ipv6af')
    ]),
    c('R1',['router eigrp CAMPUS','address-family ipv6 unicast vrf BLUE autonomous-system 85','af-interface GigabitEthernet0/0'],[
      ['no passive-interface','Permit the IPv6 EIGRP adjacency on the uplink.'],
      ['summary-address 2001:db8:8500::/40','Apply an IPv6 summary at the AF-interface.']
    ]),
    c('R3',['ipv6 router eigrp 86'],[
      ['eigrp router-id 10.86.0.3','Configure a separate classic EIGRPv6 example.'],
      ['no shutdown','Enable the classic IPv6 EIGRP process.']
    ]),
    c('R3',['interface GigabitEthernet0/0'],[
      ['ipv6 eigrp 86','Activate classic EIGRPv6 on the link.'],
      ['ipv6 hello-interval eigrp 86 5','Set the link hello interval for classic IPv6.'],
      ['ipv6 summary-address eigrp 86 2001:db8:8600::/40','Summarize reachable classic IPv6 routes on the uplink.']
    ]),
    exec('R1',[
      observe('show eigrp address-family ipv4 vrf BLUE neighbors','Inspect only the IPv4 neighbors in BLUE.',all('v4af','afLink'),'EIGRP-IPv4 Neighbors for AS(85) VRF(BLUE)\n0  192.0.2.50  Gi0/0  14','No IPv4 neighbors in BLUE.'),
      observe('show eigrp address-family ipv6 vrf BLUE topology','Confirm the IPv6 AF has a successor.','ipv6af','P 2001:db8:8501::/64, 1 successors, via fe80::2','No IPv6 AF topology entries.'),
      observe('show ip route vrf BLUE eigrp','Verify that the route was installed in BLUE.',all('v4af','afLink'),'D  10.85.17.0/24 [90/30720] via 192.0.2.50',absent)
    ]),
    exec('R3',[read('show ipv6 eigrp neighbors','Compare the verification syntax for classical EIGRPv6.','EIGRP-IPv6 Neighbors for AS(86)\n0  FE80::4  Gi0/0')])
  ]),

  lesson({
    id:'redistribution-tags',title:'Redistribution, route maps and loop prevention',topics:{encor:['3.2.a','3.2.b'],enarsi:['1.1','1.2','1.3','1.4','1.5']},portable:[4,5,6],guide:[6,7,9,12],
    topology:['R1 · OSPF domain','R2 · ASBR','R3 · EIGRP domain'],
    task:'Redistribute lab routes with a seed metric, tag them, and use a deny sequence to keep them from feeding back into their source domain.'
  }, [
    config('R2',[
      ['ip prefix-list OPS-EXPORT seq 10 permit 10.92.0.0/16 ge 24 le 26','Limit redistributed network lengths under the operations aggregate.'],
      ['ipv6 prefix-list OPS6 seq 10 permit 2001:db8:9200::/40 le 64','Select redistribution candidates from the IPv6 allocation.'],
      ['ip access-list resequence OPS-NETS 10 10','Normalize ACL numbering before editing an existing filter.']
    ]),
    c('R2',['route-map EIGRP-INTO-OSPF permit 10'],[
      ['match ip address prefix-list OPS-EXPORT','Apply the routed-prefix filter.'],
      toggle('set tag 840','Mark the EIGRP-originated prefix.','tagged'),
      ['set metric 25','Set an OSPF external metric.'],
      ['set metric-type type-1','Include intra-domain cost in the external path.']
    ]),
    c('R2',['route-map OSPF-INTO-EIGRP deny 5'],[
      toggle('match tag 840','Do not redistribute routes already marked as EIGRP-originated.','blockedBack')
    ]),
    c('R2',['route-map OSPF-INTO-EIGRP permit 20'],[
      ['set metric 100000 200 255 1 1500','Supply the EIGRP seed metric tuple.']
    ]),
    c('R2',['router ospf 92'],[
      toggle('redistribute eigrp 84 subnets route-map EIGRP-INTO-OSPF','Pass filtered EIGRP routes into OSPF with tags and metrics.','intoOspf'),
      ['redistribute connected subnets metric 35 metric-type 2','Import connected subnets as Type 2 external entries.'],
      ['distribute-list prefix OPS-EXPORT in','Restrict local RIB installation from OSPF without editing the LSDB.'],
      ['summary-address 10.92.0.0 255.255.0.0','Summarize the external routes at the ASBR.'],
      ['distance ospf intra-area 110 inter-area 110 external 160','Change only the external OSPF distance for this design.']
    ]),
    c('R2',['router eigrp 84'],[
      toggle('redistribute ospf 92 match internal external 1 external 2 route-map OSPF-INTO-EIGRP','Specify OSPF route classes and the feedback filter.','intoEigrp'),
      ['distribute-list prefix OPS-EXPORT out GigabitEthernet0/1','Limit subnet announcements on the selected EIGRP link.'],
      ['default-metric 100000 200 255 1 1500','Set a fallback metric for supported redistribution inputs.']
    ]),
    c('R2',['route-map OPS6-INTO-OSPF permit 10'],[
      ['match ipv6 address prefix-list OPS6','Match the permitted IPv6 prefixes.'],
      ['set tag 860','Set a distinct IPv6 route tag.']
    ]),
    c('R2',['router ospfv3 92','address-family ipv6 unicast'],[
      ['redistribute connected route-map OPS6-INTO-OSPF','Import allowed connected IPv6 prefixes.']
    ]),
    exec('R2',[
      observe('show route-map OSPF-INTO-EIGRP','Verify that the tag-deny is evaluated before the permit.',all('tagged','blockedBack'),
        'route-map OSPF-INTO-EIGRP, deny, sequence 5\n  Match: tag 840\nroute-map OSPF-INTO-EIGRP, permit, sequence 20','Tag policy is incomplete.'),
      observe('show ip ospf database external 10.92.24.0','Check that the selected route was redistributed with tag 840.',all('tagged','intoOspf'),
        'LS Type: AS External Link\nLink State ID: 10.92.24.0\nMetric Type: 1   Metric: 25   External Route Tag: 840','No matching external LSA.'),
      observe('show ip eigrp topology 10.92.24.0/24','Check that the original route remains internal without feedback.',all('tagged','blockedBack','intoOspf','intoEigrp'),
        'P 10.92.24.0/24, 1 successors\n  via 192.0.2.58, Internal route; no redistributed copy','Redistribution policy is incomplete.'),
      read('show ipv6 prefix-list OPS6','Inspect the IPv6 prefix and length boundaries.','seq 10 permit 2001:db8:9200::/40 le 64'),
      read('show ip protocols','Check redistribution sources, filters and administrative distances.','OSPF 92: Redistributing eigrp 84, connected\nEIGRP 84: Redistributing ospf 92\nOSPF distance: intra-area 110, inter-area 110, external 160')
    ])
  ]),

  lesson({
    id:'vrf-forwarding',title:'VRF-Lite and routing-table isolation',topics:{encor:['2.2.a','3.2.d'],enarsi:['1.1','1.7','1.11.a']},portable:[6,7,13],guide:[1,6,16],
    topology:['R2 · RED customer','R1 · Branch edge','R3 · BLUE customer'],
    task:'Configure overlapping tenant networks on separate interfaces. Verify route lookup and reachability within a single VRF.'
  }, [
    c('R1',['vrf definition RED'],[['rd 65090:10','Set the routing distinguisher for the tenant example.']]),
    c('R1',['vrf definition RED','address-family ipv4'],[]),
    c('R1',['vrf definition RED','address-family ipv6'],[]),
    c('R1',['ip vrf BLUE'],[['rd 65090:20','Use the classic IPv4-only VRF syntax in the BLUE tenant.']]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['vrf forwarding RED','Bind the uplink to RED. Reapply IP addressing after changing membership.'],
      toggle('ip address 10.90.0.1 255.255.255.252','Address the RED uplink independently.','redLink'),
      ['ipv6 address 2001:db8:9000::1/64','Provide a RED IPv6 uplink address.']
    ]),
    c('R1',['interface GigabitEthernet0/1'],[
      ['ip vrf forwarding BLUE','Bind the classic IPv4 interface to BLUE.'],
      toggle('ip address 10.90.0.1 255.255.255.252','Reuse the same addressing in a separate routing table.','blueLink')
    ]),
    config('R1',[
      toggle('ip route vrf RED 203.0.113.0 255.255.255.0 10.90.0.2','Install a RED-only route via its neighbor.','redRoute'),
      ['ip route vrf BLUE 203.0.113.0 255.255.255.0 10.90.0.2','Install the same prefix in BLUE without leaking RED routes.'],
      ['ipv6 route vrf RED 2001:db8:9001::/64 2001:db8:9000::2','Install an IPv6 tenant route.']
    ]),
    c('R1',['router bgp 65090','address-family ipv4 vrf RED'],[
      ['neighbor 10.90.0.2 remote-as 65091','Use the RED instance for this neighbor relationship.'],
      ['neighbor 10.90.0.2 activate','Activate the IPv4 tenant AF for this neighbor.']
    ]),
    exec('R1',[
      observe('show vrf','Verify the interfaces belong to separate VRFs.',all('redLink','blueLink'),'RED   65090:10   ipv4,ipv6   Gi0/0\nBLUE  65090:20   ipv4        Gi0/1','Check VRF membership.'),
      read('show ip vrf interfaces','Audit the associations even though the IPv4 addresses overlap.','Gi0/0  10.90.0.1  RED   up\nGi0/1  10.90.0.1  BLUE  up'),
      observe('show ip route vrf RED 203.0.113.0','Read the route selected inside RED.',all('redLink','redRoute'),route('S','10.90.0.2','1/0'),absent),
      read('show ip route 203.0.113.0','Demonstrate that global lookup has no tenant route.',absent),
      observe('ping vrf RED 203.0.113.5','Test reachability using the intended VRF.',all('redLink','redRoute'),'!!!!!\nSuccess rate is 100 percent (5/5)','.....\nSuccess rate is 0 percent (0/5)'),
      read('show bgp ipv4 unicast vrf RED summary','Inspect the per-VRF BGP instance and peer.','BGP local AS 65090, IPv4 Unicast VRF RED\n10.90.0.2   65091  1'),
      read('show ipv6 route vrf RED','Read the IPv6 RIB attached to RED.','S   2001:DB8:9001::/64 [1/0] via 2001:DB8:9000::2')
    ])
  ]),

  lesson({
    id:'pbr-sla-failover',title:'PBR, IP SLA and tracked static failover',topics:{encor:['3.2.d','4.4'],enarsi:['1.1','1.2','1.6','4.5']},portable:[6,8,11],guide:[6,15,24],
    topology:['PC1 · Branch clients','R1 · Tracked preferred edge','R2 · Preferred next hop · 192.0.2.66','R3 · Backup next hop · 192.0.2.70'],
    task:'Steer selected traffic using a route map and use a synthetic link failure to verify that the RIB and policy choose a backup.'
  }, [
    c('R1',['ip sla 66'],[
      toggle('icmp-echo 192.0.2.66 source-interface GigabitEthernet0/0','Probe the preferred next hop from the required source.','probe'),
      ['timeout 1000','Stop waiting for a probe result after 1000 ms.'],
      ['frequency 5','Run one probe every five seconds.'],
      ['threshold 700','Record a threshold for excessive probe RTT.']
    ]),
    config('R1',[toggle('ip sla schedule 66 life forever start-time now','Start the recurring SLA operation.','scheduled')]),
    c('R1',['track 66 ip sla 66 reachability'],[
      toggle('delay down 6 up 12','Debounce changes before withdrawing or restoring the tracked route.','tracking')
    ]),
    c('R1',['ip access-list extended BUSINESS'],[
      ['permit ip 10.72.66.0 0.0.0.255 203.0.113.0 0.0.0.255','Match a precise source and destination for policy routing.']
    ]),
    c('R1',['route-map ALT-EXIT permit 10'],[
      ['match ip address BUSINESS','Limit the alternate next hop to identified traffic.'],
      toggle('set ip next-hop verify-availability 192.0.2.66 10 track 66','Use the preferred next hop only when its tracked probe is UP.','setTracked'),
      ['set ip next-hop verify-availability 192.0.2.70 20 track 67','Provide a second eligible policy next hop.']
    ]),
    c('R1',['interface GigabitEthernet0/2'],[
      toggle('ip policy route-map ALT-EXIT','Apply policy routing to ingress branch traffic.','policy')
    ]),
    config('R1',[
      toggle('ip route 0.0.0.0 0.0.0.0 192.0.2.66 track 66','Install a default route only while the SLA object is up.','primary'),
      toggle('ip route 0.0.0.0 0.0.0.0 192.0.2.70 200','Install a floating default with a worse administrative distance.','backup'),
      ['ip local policy route-map ALT-EXIT','Practice explicit policy attachment for locally originated packets.']
    ]),
    exec('R1',[
      observe('show track 66','Confirm the source operation, reachability and change reason.',s=>all('probe','scheduled','tracking')(s)&&!s.failure,
        'Track 66: IP SLA 66 reachability\nReachability is Up\nLatest operation return code: OK','Track 66: Reachability is Down\nLatest operation return code: Timeout'),
      observe('show ip sla statistics 66','Read the latest synthetic sample.',s=>all('probe','scheduled')(s)&&!s.failure,
        'Latest RTT: 3 ms\nLatest operation return code: OK','Latest operation return code: Timeout or unscheduled'),
      observe('show ip policy','Check the applied route map at the ingress interface.','policy','Interface      Route map\nGi0/2          ALT-EXIT','No interface policy is active.'),
      observe('show ip route 0.0.0.0','Validate that the preferred default is installed while its track is up.',s=>all('probe','scheduled','tracking','primary')(s)&&!s.failure,
        'S* 0.0.0.0/0 [1/0] via 192.0.2.66',s=>s.backup?'S* 0.0.0.0/0 [200/0] via 192.0.2.70':'No default route.')
    ]),
    c('R2',['interface GigabitEthernet0/0'],[toggle('shutdown','Simulate the primary link outage and its settled tracking state.','failure')]),
    exec('R1',[
      observe('show track 66','Check the track after the outage has settled.',s=>all('probe','scheduled','tracking')(s)&&!s.failure,
        'Track 66: IP SLA 66 reachability\nReachability is Up\nLatest operation return code: OK','Track 66: Reachability is Down\nLatest operation return code: Timeout'),
      observe('show ip route 0.0.0.0','Confirm the floating default replaced the tracked route.',s=>all('probe','scheduled','tracking','primary')(s)&&!s.failure,
        'S* 0.0.0.0/0 [1/0] via 192.0.2.66',s=>s.backup?'S* 0.0.0.0/0 [200/0] via 192.0.2.70':'No default route.'),
      observe('show route-map ALT-EXIT','Verify that the tracked next hop is skipped when down.',all('policy','setTracked'),
        s=>'route-map ALT-EXIT, permit, sequence 10\nPreferred policy next hop: '+(s.failure?'192.0.2.70 (backup)':'192.0.2.66'),'Policy is incomplete.')
    ]),
    shell('PC1',[
      observe('traceroute -n 203.0.113.9','Confirm the branch traffic takes the available policy next hop.',all('policy','setTracked','probe','scheduled','tracking'),
        s=>'1  10.72.66.1\n2  '+(s.failure?'192.0.2.70':'192.0.2.66')+'\n3  203.0.113.9','No policy path installed.')
    ]),
    c('R2',['interface GigabitEthernet0/0'],[toggle('no shutdown','Restore the primary circuit.','failure',false)]),
    exec('R1',[
      observe('show ip route 0.0.0.0','After the tracking delay, confirm primary preference is restored.',s=>all('probe','scheduled','tracking','primary')(s)&&!s.failure,
        'S* 0.0.0.0/0 [1/0] via 192.0.2.66',s=>s.backup?'S* 0.0.0.0/0 [200/0] via 192.0.2.70':'No default route.')
    ])
  ]),

  lesson({
    id:'rib-fib-bfd',title:'RIB, FIB, floating routes and BFD',topics:{encor:['1.1.b','3.2.c','4.1'],enarsi:['1.1','1.8','1.11.b']},portable:[6,7,11],guide:[1,6,11],
    topology:['R1 · Primary tracked path','R2 · BFD peer','R3 · Backup'],
    task:'Trace the recursive forwarding decision and compare the primary route with the backup during a BFD failure.'
  }, [
    config('R1',[
      ['ip cef','Enable Cisco Express Forwarding on platforms where this is configurable.'],
      ['ipv6 unicast-routing','Enable IPv6 forwarding.'],
      ['ip route 203.0.113.0 255.255.255.0 192.0.2.75 185','Configure a higher-distance floating route.'],
      ['ipv6 route 2001:db8:72::/48 GigabitEthernet0/0 fe80::2','Provide both the interface and link-local next hop for IPv6.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      toggle('bfd interval 100 min_rx 100 multiplier 3','Request fast BFD transmit/receive timing with a multiplier.','bfd1'),
      ['ip ospf bfd','Tie OSPF failure detection on the interface to BFD.']
    ]),
    c('R2',['interface GigabitEthernet0/0'],[
      toggle('bfd interval 100 min_rx 100 multiplier 3','Configure compatible settings on the adjacent router.','bfd2'),
      ['ip ospf bfd','Enable the OSPF client on the second router.']
    ]),
    exec('R1',[
      observe('show bfd neighbors details','Verify both ends negotiated a session and interval.',s=>all('bfd1','bfd2')(s)&&!s.failed,
        'Neighbor 192.0.2.74  State Up  Int Gi0/0\nTX 100 ms, RX 100 ms, multiplier 3','Neighbor 192.0.2.74  State Down'),
      observe('show ip route 203.0.113.5','Locate the best matching prefix and its installed next hop.',s=>all('bfd1','bfd2')(s)&&!s.failed,
        route('O','192.0.2.74','110/20'),route('S','192.0.2.75','185/0')),
      observe('show ip cef exact-route 10.72.0.6 203.0.113.5','Read the forwarding next hop for the selected source/destination pair.',s=>!s.failed,
        '10.72.0.6 -> 203.0.113.5 : Gi0/0 (192.0.2.74)','10.72.0.6 -> 203.0.113.5 : Gi0/1 (192.0.2.75)'),
      read('show ip cef 203.0.113.0/24 detail','Review the FIB prefix, recursive next-hop and adjacency.','203.0.113.0/24, flags [rib defined]\n  nexthop 192.0.2.74 GigabitEthernet0/0'),
      read('show adjacency GigabitEthernet0/0 detail','Inspect the egress rewrite information.','IP Gi0/0 192.0.2.74\n  Encap length 14 · resolved ARP adjacency'),
      read('show ipv6 cef 2001:db8:72::/48','Read the IPv6 forwarding entry independently.','2001:DB8:72::/48\n  nexthop FE80::2 GigabitEthernet0/0')
    ]),
    c('R2',['interface GigabitEthernet0/0'],[toggle('shutdown','Take down the primary peer link in the scenario.','failed')]),
    exec('R1',[
      observe('show bfd neighbors details','Check failure detection after the link goes down.',s=>all('bfd1','bfd2')(s)&&!s.failed,
        'Neighbor 192.0.2.74  State Up  Int Gi0/0\nTX 100 ms, RX 100 ms, multiplier 3','Neighbor 192.0.2.74  State Down'),
      observe('show ip route 203.0.113.5','Inspect the fallback route after OSPF withdraws.',s=>all('bfd1','bfd2')(s)&&!s.failed,
        route('O','192.0.2.74','110/20'),route('S','192.0.2.75','185/0')),
      observe('show ip cef exact-route 10.72.0.6 203.0.113.5','Confirm the FIB also points to the fallback.',s=>!s.failed,
        '10.72.0.6 -> 203.0.113.5 : Gi0/0 (192.0.2.74)','10.72.0.6 -> 203.0.113.5 : Gi0/1 (192.0.2.75)')
    ])
  ])
];
