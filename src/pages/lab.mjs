export function lab() {
  return `<section class="sim-heading"><div class="frame">
  <div><p class="eyebrow">NETRA LABSIM</p><h1>Build a network<span>.</span></h1><p>Connect devices, configure their ports, and test how traffic moves.</p></div>
  <div class="sim-project"><p id="sim-count">0 / 50 devices</p><small>Up to 10 of each type</small></div>
</div></section>
<section class="sim-workspace frame" aria-label="Network simulator">
  <div class="sim-tools">
    <div id="sim-add" class="sim-add" aria-label="Add devices"></div>
    <div class="sim-actions"><button type="button" id="sim-export" class="sim-button">Export JSON</button><button type="button" id="sim-starter" class="sim-button">Load Branch LAN</button><button type="button" id="sim-empty" class="sim-button">New empty lab</button></div>
  </div>
  <p id="sim-status" role="status" class="sim-status"></p>
  <div class="sim-grid">
    <div class="sim-core">
      <section class="sim-panel" aria-label="Network topology">
        <div class="sim-bar"><h2>Topology</h2><span id="sim-save">Browser workspace</span></div>
        <div class="sim-board-scroll" tabindex="0" aria-label="Topology canvas scrolling area">
          <div id="sim-board" class="sim-board"><canvas id="sim-lines" aria-hidden="true"></canvas><div id="sim-nodes"></div><p id="sim-board-empty">Add devices to begin.</p></div>
        </div>
        <div class="sim-legend"><span><i></i> Ethernet up</span><span><i></i> Down</span><span><i></i> Wi-Fi</span><span><i></i> Last traffic path</span></div>
      </section>
      <section class="sim-panel sim-console" aria-label="Device console">
        <div class="sim-bar"><h2 id="sim-console-title">Device console</h2><button class="sim-button" type="button" id="sim-clear">Clear</button></div>
        <pre id="sim-output" role="log" tabindex="0" aria-label="Command output"></pre>
        <form id="sim-console"><label id="sim-prompt" for="sim-command">›</label><input id="sim-command" aria-label="CLI command" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512" placeholder="Type sh ip int br or ? for help"><button class="sim-button sim-accent" type="submit">Run ⏎</button></form>
        <p class="sim-keyboard"><kbd>?</kbd> Show matching commands <kbd>Tab</kbd> Complete a keyword <kbd>↑</kbd> Recall</p>
      </section>
    </div>
    <aside class="sim-side">
      <section class="sim-panel" aria-label="Selected device">
        <div class="sim-bar"><h2 id="sim-inspector-title">Device</h2><button type="button" id="sim-remove" class="sim-button">Remove</button></div>
        <dl id="sim-inspector" class="sim-inspector"></dl>
        <details class="sim-reference"><summary>Commands for this device</summary><div class="sim-ref-controls"><label>Find a command<input id="sim-command-search" type="search" placeholder="e.g. ospf, trunk, ssid"></label><label>Coverage<select id="sim-command-scope"><option value="live">Live LabSim</option><option value="guided">CCNA study reference</option></select></label></div><div id="sim-commands"></div></details>
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
      <details class="sim-panel sim-help"><summary>Try the starter network</summary><ol>
        <li>Select <b>PC1</b> and run <code>ping 192.168.20.21</code> to reach the IP phone across the staff and voice VLANs.</li>
        <li>On <b>SW1</b>, enter <code>enable</code>, <code>configure terminal</code>, <code>interface gi0/3</code>, then <code>shutdown</code>. Repeat the PC ping and compare the result. Use <code>no shutdown</code> to restore the port.</li>
        <li>Add a PC, select it, and run <code>wifi join Netra-Staff NetraLab26</code>, then <code>ipconfig /renew</code> and <code>ping 192.168.10.1</code>.</li>
      </ol><p>The starter network includes dummy credentials. LabSim uses a Cisco-style CLI for routers and switches and a dedicated AP CLI for the simulated radio. The command list shows which syntax runs in this workspace.</p></details>
    </aside>
  </div>
  <dialog id="sim-confirm"><form method="dialog"><h2 id="sim-confirm-title">Replace this workspace?</h2><p id="sim-confirm-copy"></p><div><button class="sim-button" value="cancel" autofocus>Cancel</button><button class="sim-button sim-accent" value="confirm">Continue</button></div></form></dialog>
</section>`;
}
