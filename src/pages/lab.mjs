export function lab() {
  return `<section class="interior-hero lab-hero"><div class="frame"><p class="eyebrow">LABSIM · WORKSPACE PREVIEW</p><h1>Branch LAN.</h1><p>Choose a device, inspect its ports, and run a sample command in the console.</p></div></section>
  <section class="workspace frame" aria-label="Branch LAN workspace">
    <div class="topology">
      <div class="terminal-bar"><span class="terminal-dot"></span> TOPOLOGY <span>Branch LAN</span></div>
      <div class="mini-map lab-map">
        <button type="button" data-device="R1" aria-pressed="true"><b aria-hidden="true">◈</b>R1 <small>Router</small></button><span aria-hidden="true"></span>
        <button type="button" data-device="SW1" aria-pressed="false"><b aria-hidden="true">▤</b>SW1 <small>Switch</small></button><span aria-hidden="true"></span>
        <button type="button" data-device="PC1" aria-pressed="false"><b aria-hidden="true">▣</b>PC1 <small>Host</small></button>
      </div>
      <div class="inspector"><h2 id="inspector-title">R1 ports and modules</h2><ul id="device-ports"></ul></div>
    </div>
    <div class="terminal live-terminal">
      <div class="terminal-bar"><span class="terminal-dot"></span> CONSOLE PREVIEW <span id="console-device">R1</span></div>
      <pre id="console-output" role="log" aria-label="Console output">Type help to see available commands.</pre>
      <form id="console-form"><label for="console-input" id="console-prompt">R1#</label>
      <input id="console-input" aria-label="Console command" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="help"><button type="submit">Run</button></form>
      <div class="terminal-caption">Sample outputs from a fixed topology</div>
    </div>
  </section>
  <script type="module" src="/features/labsim/demo.js"></script>`;
}
