import { capacity, deviceLimit } from '../features/labsim/platforms.js';

export function lab() {
  return `<section class="sim-heading"><div class="frame">
  <div><p class="eyebrow">NETRA LABSIM</p><h1>Build a network<span>.</span></h1><p>Build a topology, configure its devices, and see where traffic succeeds or fails.</p></div>
  <div class="sim-project"><p id="sim-count">0 / ${capacity} devices</p><small>Up to ${deviceLimit} of each type</small></div>
</div></section>
<section class="sim-workspace frame" aria-label="Network simulator">
  <div class="sim-tools">
    <div id="sim-add" class="sim-add" aria-label="Add devices"></div>
    <div class="sim-actions"><button type="button" id="sim-enterprise" class="sim-button sim-accent">Load Enterprise Campus</button><button type="button" id="sim-routing" class="sim-button">Load Routing Core</button><select id="sim-voice-lab" aria-label="Load a voice lab"><option value="">Load a voice lab</option><option value="starter">CME · Configure the phones</option><option value="ready">CME · Ready to call</option></select><select id="sim-vpn-lab" aria-label="Load a VPN topology"><option value="">Load a VPN topology</option><option value="provider-vpn">Provider VPN · MPLS</option><option value="dmvpn">DMVPN Phase 3</option></select><a class="sim-button" href="#ios-commands" id="ios-command-link">Command index</a><a class="sim-button" href="/labsim/ccnp/">CCNP guided labs</a><button type="button" id="sim-export" class="sim-button">Export JSON</button><button type="button" id="sim-import" class="sim-button">Import JSON</button><input id="sim-import-file" type="file" accept=".json,application/json" hidden><button type="button" id="sim-starter" class="sim-button">Load Branch LAN</button><button type="button" id="sim-empty" class="sim-button">New empty lab</button></div>
  </div>
  <p id="sim-status" role="status" class="sim-status"></p>
  <div class="sim-grid">
    <div class="sim-core">
      <section class="sim-panel" aria-label="Network topology">
        <div class="sim-bar"><h2 id="sim-board-name">Topology</h2><span id="sim-save">Browser workspace</span></div>
        <div class="sim-board-scroll" tabindex="0" aria-label="Topology canvas scrolling area">
          <div id="sim-board" class="sim-board"><canvas id="sim-lines" aria-hidden="true"></canvas><div id="sim-nodes"></div><p id="sim-board-empty">Add devices to begin.</p></div>
        </div>
        <div class="sim-legend"><span><i></i> Ethernet up</span><span><i></i> Down</span><span><i></i> Wi-Fi</span><span><i></i> Last traffic path</span><span><i></i> CAPWAP</span></div>
      </section>
      <details class="sim-panel sim-help sim-scenario" data-lab-scenario="enterprise" hidden open>
        <summary>Test the Enterprise Campus</summary>
        <ol>
          <li>On <b>PC1</b>, <button type="button" data-device="PC1" data-lab-command="wifi join Netra-Enterprise enterprise student NetraStudent">join the enterprise WLAN</button>, <button type="button" data-device="PC1" data-lab-command="ipconfig /renew">request DHCP</button>, and <button type="button" data-device="PC1" data-lab-command="ping provider.netra.test">ping the BGP-learned destination</button>.</li>
          <li>On <b>PC2</b>, <button type="button" data-device="PC2" data-lab-command="dot1x login student NetraStudent">authenticate over wired 802.1X</button>, then <button type="button" data-device="PC2" data-lab-command="ipconfig /renew">request DHCP</button>. Review the <button type="button" data-device="ISE1" data-lab-command="show radius live-logs">RADIUS log on ISE1</button>.</li>
          <li>On <b>TEL1</b>, <button type="button" data-device="TEL1" data-lab-command="dial 2002">dial TEL2</button>. Review the <button type="button" data-device="SRV1" data-lab-command="show sip registrations">registrations on SRV1</button>.</li>
          <li>On <b>R1</b>, <button type="button" data-device="R1" data-lab-command="sh ip bgp sum">check eBGP</button>. Shut down <code>Gi0/1</code> and retry the provider ping. Use <code>no shutdown</code> to restore the peering.</li>
        </ol>
        <p>Choose a command to load it into the console, then press Enter.</p>
      </details>
      <details class="sim-panel sim-help sim-scenario" data-lab-scenario="routing" hidden open>
        <summary>Test the Routing Core</summary>
        <ol>
          <li>On <b>R1</b>, <button type="button" data-device="R1" data-lab-command="show tunnel interface tunnel72">inspect the GRE tunnel</button>, then <button type="button" data-device="R1" data-lab-command="show ip ospf neighbor">confirm the OSPF adjacency</button> and <button type="button" data-device="R1" data-lab-command="show ip route ospf">check inter-area and external routes</button>.</li>
          <li>On <b>R3</b>, <button type="button" data-device="R3" data-lab-command="show ip eigrp topology">inspect EIGRP</button>. Check the <button type="button" data-device="R3" data-lab-command="show route-map IMPORT-EDGE">redistribution policy</button> for the loopback advertised by R4.</li>
          <li>On <b>PC1</b>, <button type="button" data-device="PC1" data-lab-command="ping 10.72.90.4">ping the R4 loopback</button>. Change R3’s tunnel key to <code>73</code> and retry. Restore it to <code>72</code> to bring back the adjacency and route.</li>
        </ol>
        <p>Choose a command to load it into the console, then press Enter.</p>
      </details>
      <details class="sim-panel sim-help sim-scenario" data-lab-scenario="provider-vpn" hidden open>
        <summary>Trace a tenant route through the provider core</summary>
        <ol>
          <li>On <b>R1</b>, <button type="button" data-device="R1" data-lab-command="show mpls ldp neighbor">check LDP</button>, then <button type="button" data-device="R1" data-lab-command="show bgp vpnv4 unicast all 198.18.0.0/24">inspect the route target and VPN label</button>.</li>
          <li>On <b>PC1</b>, <button type="button" data-device="PC1" data-lab-command="ping 198.18.0.2">ping PC2 across the VPN</button>. The path crosses both provider edges and the core.</li>
          <li>On <b>R2</b>, apply <code>no mpls ip</code> to <code>Gi0/1</code>. Retry the ping and <button type="button" data-device="R1" data-lab-command="show ip route vrf LAB-WEST">check which route disappeared</button>. Use <code>mpls ip</code> to restore label forwarding.</li>
        </ol>
      </details>
      <details class="sim-panel sim-help sim-scenario" data-lab-scenario="dmvpn" hidden open>
        <summary>Watch the DMVPN spokes learn a shorter path</summary>
        <ol>
          <li>On <b>R1</b>, <button type="button" data-device="R1" data-lab-command="show dmvpn">check spoke registrations</button> and <button type="button" data-device="R1" data-lab-command="show crypto ikev2 sa">verify IKEv2 settings</button>.</li>
          <li>On <b>PC1</b>, <button type="button" data-device="PC1" data-lab-command="ping 10.79.3.2">ping PC2 twice</button>. Compare the first path through the hub with the next path directly between spokes.</li>
          <li>On <b>R2</b>, <button type="button" data-device="R2" data-lab-command="show ip nhrp shortcut">inspect the shortcut</button> and <button type="button" data-device="R2" data-lab-command="show crypto ipsec sa">read the IPsec counters</button>. These counters model negotiated protection and forwarded packets.</li>
        </ol>
      </details>
      <details class="sim-panel sim-help sim-scenario" data-lab-scenario="voice-cme" hidden open>
        <summary>Configure and test SCCP calls</summary>
        <ol>
          <li>SW1 carries data VLAN 10 and voice VLAN 20. Check the <button type="button" data-device="SW1" data-lab-command="show interfaces Gi0/2 switchport">phone-facing switchport</button>. PC1 shares that port through TEL1.</li>
          <li>In a fresh voice lab, add <code>option 150 ip 10.20.20.1</code> to DHCP pool <code>VOICE</code> on R1. Set up <code>telephony-service</code>, DNs 2001 and 2002, and run <code>create cnf-files</code>. <a href="/ccnp/?track=encor&amp;lab=voice-cme-sccp#labs">Open the configuration walkthrough</a>.</li>
          <li><button type="button" data-device="TEL1" data-lab-command="boot">Boot TEL1</button>, then <button type="button" data-device="TEL2" data-lab-command="boot">boot TEL2</button>. Check <button type="button" data-device="R1" data-lab-command="show ephone registered summary">which phones registered</button> in privileged EXEC.</li>
          <li><button type="button" data-device="TEL1" data-lab-command="dial 2002">Dial 2002 from TEL1</button> and <button type="button" data-device="TEL2" data-lab-command="answer">answer on TEL2</button>. <button type="button" data-device="R1" data-lab-command="show telephony-service events">Read the CME event log</button> for ringing, connected, or failed states.</li>
        </ol>
        <p>Choose a command to load it into the console, then press Enter.</p>
      </details>
      <section class="sim-panel sim-console" aria-label="Device console">
        <div class="sim-bar"><h2 id="sim-console-title">Device console</h2><button class="sim-button" type="button" id="sim-clear">Clear</button></div>
        <pre id="sim-output" role="log" tabindex="0" aria-label="Command output"></pre>
        <form id="sim-console"><label id="sim-prompt" for="sim-command">›</label><input id="sim-command" aria-label="CLI command" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512" placeholder="Type sh ip int br or ? for help"><button class="sim-button sim-accent" type="submit">Run ⏎</button></form>
        <div id="sim-phone-controls" class="sim-phone-controls" hidden>
          <p id="sim-phone-state" role="status"></p>
          <div class="sim-phone-actions">
            <button class="sim-button" type="button" data-phone-command="boot">Boot / register</button>
            <button class="sim-button sim-accent" type="button" data-phone-command="answer">Answer</button>
            <button class="sim-button" type="button" data-phone-command="reject">Reject</button>
            <button class="sim-button" type="button" data-phone-command="hangup">Hang up</button>
            <button class="sim-button" type="button" data-phone-command="show phone log">Call log</button>
          </div>
        </div>
        <p class="sim-keyboard"><kbd>?</kbd> Show matching commands <kbd>Tab</kbd> Complete a keyword <kbd>↑</kbd> Recall</p>
      </section>
    </div>
    <aside class="sim-side">
      <section class="sim-panel" aria-label="Selected device">
        <div class="sim-bar"><h2 id="sim-inspector-title">Device</h2><button type="button" id="sim-remove" class="sim-button">Remove</button></div>
        <dl id="sim-inspector" class="sim-inspector"></dl>
        <details class="sim-reference"><summary>Commands for this device</summary><div class="sim-ref-controls"><label>Find a command<input id="sim-command-search" type="search" placeholder="e.g. ospf, trunk, ssid"></label><label>Coverage<select id="sim-command-scope"><option value="live">Live LabSim</option><option value="guided">CCNA study reference</option><option value="ccnp">CCNP guided labs</option></select></label></div><div id="sim-commands"></div></details>
      </section>
      <section class="sim-panel" aria-label="Cable connections">
        <div class="sim-bar"><h2>Cables</h2></div>
        <form id="sim-cables">
          <div><label>Device A<select id="sim-a"></select></label><label>Port A<select id="sim-a-port"></select></label></div>
          <div><label>Device B<select id="sim-b"></select></label><label>Port B<select id="sim-b-port"></select></label></div>
          <button type="submit" class="sim-button sim-accent">Connect Ethernet</button>
        </form>
        <ul id="sim-links" class="sim-links"></ul>
      </section>
      <details class="sim-panel sim-help" data-lab-scenario="branch" hidden><summary>Try the starter network</summary><ol>
        <li>Select <b>PC1</b> and run <code>ping 192.168.20.21</code> to reach the IP phone across the staff and voice VLANs.</li>
        <li>On <b>SW1</b>, enter <code>enable</code>, <code>configure terminal</code>, <code>interface gi0/3</code>, then <code>shutdown</code>. Repeat the PC ping and compare the result. Use <code>no shutdown</code> to restore the port.</li>
        <li>Add a PC, select it, and run <code>wifi join Netra-Staff NetraLab26</code>, then <code>ipconfig /renew</code> and <code>ping 192.168.10.1</code>.</li>
      </ol><p>The starter network uses lab credentials. Open Commands for this device to see the syntax available in the live console.</p></details>
    </aside>
  </div>
  <details id="ios-commands" class="sim-panel ios-command-index">
    <summary>CCNA and CCNP command index</summary>
    <div class="ios-command-body">
      <p>Open any course example with its setup loaded. Commands checked in LabSim can also be sent to a device console. Match the CLI mode and topology shown in the example before running.</p>
      <div class="ios-command-filters">
        <label>Search commands<input id="ios-command-query" type="search" placeholder="e.g. show bgp ipv6, VTP, MPLS"></label>
        <label>Track<select id="ios-command-track"><option value="">All tracks</option><option value="ccna">CCNA</option><option value="encor">ENCOR</option><option value="enarsi">ENARSI</option></select></label>
        <label>Availability<select id="ios-command-availability"><option value="">All examples</option><option value="live">Checked in LabSim</option><option value="guided">Guided setup</option></select></label>
      </div>
      <p id="ios-command-count" role="status"></p>
      <ul id="ios-command-results"></ul>
      <button id="ios-command-more" type="button" class="sim-button" hidden>Show more commands</button>
    </div>
  </details>
  <dialog id="sim-confirm"><form method="dialog"><h2 id="sim-confirm-title">Replace this workspace?</h2><p id="sim-confirm-copy"></p><div><button class="sim-button" value="cancel" autofocus>Cancel</button><button class="sim-button sim-accent" value="confirm">Continue</button></div></form></dialog>
</section>`;
}
