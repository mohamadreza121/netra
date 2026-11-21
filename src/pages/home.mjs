const ccnpExamples = [
  {
    topic: 'OSPF',
    device: 'CORE-01',
    command: 'show ip ospf neighbor detail',
    output: `Neighbor 10.255.0.2, interface address 10.0.12.2
    In the area 0 via interface GigabitEthernet0/0
    Neighbor priority is 1, State is FULL
    Dead timer due in 00:00:36`,
    caption: 'Confirm full adjacency in backbone area 0.'
  },
  {
    topic: 'BGP',
    device: 'EDGE-01',
    command: 'show ip bgp 203.0.113.0',
    output: `BGP routing table entry for 203.0.113.0/24
Paths: (2 available, best #1, table default)
  64512
    192.0.2.1 from 192.0.2.1 (10.255.1.1)
      Origin IGP, localpref 200, valid, external, best
  64513
    192.0.2.5 from 192.0.2.5 (10.255.1.2)
      Origin IGP, localpref 100, valid, external`,
    caption: 'Compare two paths and identify the selected next hop.'
  },
  {
    topic: 'Route Policy',
    device: 'EDGE-01',
    command: 'show route-map PREFER-PRIMARY',
    output: `route-map PREFER-PRIMARY, permit, sequence 10
  Match clauses:
    ip address prefix-lists: PARTNER-NETS
  Set clauses:
    local-preference 200`,
    caption: 'Check which prefixes receive higher local preference.'
  },
  {
    topic: 'Redistribution',
    device: 'CORE-01',
    command: 'show ip route 10.40.0.0',
    output: `Routing entry for 10.40.0.0/16
  Known via "ospf 10", distance 110, metric 20, type extern 2
  Routing Descriptor Blocks:
  * 10.0.12.2, via GigabitEthernet0/0
      Route metric is 20, traffic share count is 1
      Route tag 65010`,
    caption: 'Verify the redistributed route’s external metric and tag.'
  }
];

function ccnpConsole({ topic, device, command, output, caption }) {
  return `<article class="terminal ccnp-console">
<div class="terminal-bar"><span class="terminal-dot" aria-hidden="true"></span><h3>${topic}</h3><span>${device}</span></div>
<pre><code><span class="prompt">${device}#</span> <strong>${command}</strong>

${output}</code></pre>
<div class="terminal-caption">${caption}</div>
</article>`;
}

export function home() {
return `<section class="ccna-section" id="ccna"><div class="frame section-grid">
<div class="section-copy">
<p class="eyebrow">CCNA PRACTICE</p><h2>Build the<br>network<span>.</span></h2>
<p>Bring up an interface. Pass traffic across a trunk. Verify a route. Get comfortable with one command set at a time.</p>
<a class="button ink" href="/ccna/">Explore CCNA topics</a>
</div>
<div class="terminal ccna-terminal">
<div class="terminal-bar"><span class="terminal-dot"></span> SWITCH CONSOLE <span>SW1</span></div>
<pre><span class="prompt">SW1#</span> show vlan brief

VLAN Name          Status    Ports
---- ------------- --------- --------
1    default       active   Gi0/1
10   STAFF         active   Gi0/2
20   GUEST         active   Gi0/3

<span class="prompt">SW1#</span> <b class="cursor"> </b></pre>
<div class="terminal-caption">Sample output · Verify access VLAN assignments</div>
</div>
</div></section>
<section class="ccnp-section" id="ccnp" aria-labelledby="ccnp-title"><div class="frame ccnp-grid">
<div class="section-copy">
<p class="eyebrow">CCNP PRACTICE</p>
<h2 id="ccnp-title">Think in<br>networks<span>.</span></h2>
<p>Verify OSPF adjacencies, compare BGP paths, and see how policy and redistribution shape the routing table.</p>
<a class="button violet-button" href="/ccnp/">Explore CCNP Practice</a>
</div>
<div class="console-stack" aria-label="Sample router output">
${ccnpExamples.map(ccnpConsole).join('')}
</div>
</div></section>
<section class="lab-section" id="labsim"><div class="frame section-grid">
<div class="section-copy"><p class="eyebrow">LABSIM</p><h2>Bring it<br>online<span>.</span></h2><p>Cable routers, switches, and endpoints. Configure them in the console and follow the traffic through your topology.</p><a class="button primary" href="/labsim/">Open LabSim</a></div>
<div class="lab-mini" aria-hidden="true">
<div class="terminal-bar"><span class="terminal-dot"></span> TOPOLOGY <span>Branch LAN</span></div>
<div class="mini-map"><div><b>◈</b>R1</div><span></span><div><b>▤</b>SW1</div><span></span><div><b>▣</b>PC1</div></div>
<div class="mini-code"><code><span class="prompt">R1#</span> show ip interface brief</code></div>
</div>
</div></section>`;
}
