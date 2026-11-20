const panel = (symbol, title, body, command) => `<article class="topic-tile">
<span class="tile-symbol" aria-hidden="true">${symbol}</span><h3>${title}</h3><p>${body}</p>
<code>${command}</code></article>`;

export function home() {
return `<section class="hero" aria-labelledby="hero-title">
<div class="hero-art" aria-hidden="true"></div>
<div class="frame hero-inner">
<div class="hero-copy">
<p class="eyebrow hero-kicker"><span class="signal"></span> CISCO NETWORKING PRACTICE</p>
<h1 id="hero-title" aria-label="Netra"><span aria-hidden="true"><i>N</i><i>e</i><i>t</i><i>r</i><i>a</i><i>.</i></span></h1>
<p class="tagline">Learn. Simulate. Master.</p>
<p class="hero-description">Practice Cisco commands, build topologies, and see how the network responds.</p>
<div class="actions"><a class="button primary" href="#ccna">Explore the tracks</a><a class="button ghost" href="/labsim/">Preview LabSim</a></div>
</div>
</div>
<div class="frame hero-foot"><a href="#ccna"><span aria-hidden="true">↓</span> Scroll to explore</a><span>NETWORK + ASTRA</span></div>
</section>
<section class="ccna-section" id="ccna"><div class="frame section-grid">
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
<section class="ccnp-section" id="ccnp"><div class="frame">
<div class="ccnp-heading"><div class="section-copy"><p class="eyebrow">CCNP PRACTICE</p>
<h2>Think in<br>networks<span>.</span></h2><p>Follow routes beyond a single device. Work through neighbor state, path selection, and the effect of a routing policy.</p></div>
<a class="button ghost" href="/ccnp/">Explore CCNP topics</a></div>
<div class="rail-controls" aria-label="Topic rail controls"><button type="button" data-rail-step="-1" aria-label="Previous topics">←</button><button type="button" data-rail-step="1" aria-label="Next topics">→</button></div>
<div class="topic-rail" tabindex="0" aria-label="CCNP topic examples">
${panel('◎','OSPF','Trace an adjacency from the first hello to a learned route.','show ip ospf neighbor')}
${panel('⬡','BGP','Inspect peering and compare the paths behind a prefix.','show bgp ipv4 unicast')}
${panel('⌘','Route policy','Match a set of prefixes and see what the router advertises.','show route-map')}
${panel('⇄','Redistribution','Follow a route as it moves between routing domains.','show ip protocols')}
</div>
</div></section>
<section class="lab-section" id="labsim"><div class="frame section-grid">
<div class="section-copy"><p class="eyebrow">LABSIM</p><h2>Bring it<br>online<span>.</span></h2><p>Open the workspace preview to select devices, inspect ports, and try a small set of console commands.</p><a class="button primary" href="/labsim/">Open LabSim</a></div>
<div class="lab-mini" aria-hidden="true">
<div class="terminal-bar"><span class="terminal-dot"></span> TOPOLOGY <span>Branch LAN</span></div>
<div class="mini-map"><div><b>◈</b>R1</div><span></span><div><b>▤</b>SW1</div><span></span><div><b>▣</b>PC1</div></div>
<div class="mini-code"><code><span class="prompt">R1#</span> show ip interface brief</code></div>
</div>
</div></section>`;
}
