export const tracks = {
  ccna: {
    title: 'CCNA Practice',
    headline: 'Build the network.',
    description: 'Start with the commands you’ll use to bring interfaces up, connect switches, and route between networks.',
    topics: [
      ['Device setup', 'Configure hostnames, interfaces, and basic management access.', 'show ip interface brief'],
      ['VLANs & trunks', 'Create VLANs, assign access ports, and verify a trunk.', 'show interfaces trunk'],
      ['IPv4 & IPv6 routing', 'Configure static routes and inspect the routing table.', 'show ip route'],
      ['Single-area OSPF', 'Bring up an adjacency and verify learned routes.', 'show ip ospf neighbor'],
      ['IP services', 'Practice DHCP relay, NAT, and NTP configuration.', 'show ip nat translations'],
      ['Access controls', 'Apply a traffic filter and inspect which entries match.', 'show access-lists']
    ]
  },
  ccnp: {
    title: 'CCNP Practice',
    headline: 'Think in networks.',
    description: 'Work through routing policy, path selection, and the verification steps that explain why traffic takes a particular path.',
    topics: [
      ['OSPF', 'Examine neighbor state, area boundaries, and route selection.', 'show ip ospf database'],
      ['BGP', 'Bring up peering and trace the effect of route policy.', 'show bgp ipv4 unicast summary'],
      ['Route policy', 'Match prefixes and control route advertisements.', 'show route-map'],
      ['Redistribution', 'Verify route sources, metrics, and tagging.', 'show ip protocols'],
      ['Layer 2 resiliency', 'Analyze spanning-tree roles and EtherChannel state.', 'show etherchannel summary'],
      ['Assurance', 'Use interface counters and forwarding state to diagnose faults.', 'show interfaces counters errors']
    ]
  }
};
