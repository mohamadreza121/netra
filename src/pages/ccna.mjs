import { wirelessPractice } from './ccna-wireless.mjs';
import { commandCount, labs } from '../features/ccna/catalog.mjs';
import { concepts } from '../features/ccna/concepts.mjs';

export function ccnaPractice() {
  return `<section class="ccna-intro">
  <div class="frame">
    <p class="eyebrow">CCNA 200-301 · V1.1</p>
    <h1>CCNA Practice<span>.</span></h1>
    <p>Configure routers and switches, send test traffic, and verify what changed.</p>
    <div class="ccna-summary"><span><b>${labs.length}</b> CLI labs</span><span><b>${commandCount}</b> command examples</span><span><b>${concepts.length}</b> concept checks</span></div>
  </div>
</section>
<section class="ccna-workspace frame" aria-label="CCNA practice workspace">
  <div class="ccna-toolbar">
    <nav class="ccna-views" aria-label="Practice views">
      <a href="#labs" data-view="labs" aria-current="page">CLI labs</a>
      <a href="#reference" data-view="reference">Command reference</a>
      <a href="#concepts" data-view="concepts">Concept checks</a>
      <a href="#wlan" data-view="wlan">Wireless lab</a>
    </nav>
    <label class="ccna-search" for="ccna-search"><span>Search topics and commands</span><input id="ccna-search" type="search" placeholder="Try OSPF, trunk, or show ip route"></label>
  </div>
  <div class="ccna-domains" id="ccna-domains" aria-label="Exam domains"></div>
  <div data-panel="labs" class="ccna-labs">
    <aside class="ccna-lab-list"><h2>Lab library</h2><div id="ccna-lab-list"></div></aside>
    <section class="ccna-active-lab" aria-label="Selected lab">
      <div class="ccna-lab-heading"><div><p id="lab-objective" class="eyebrow"></p><h2 id="lab-title"></h2><p id="lab-task"></p></div><button class="ccna-control" id="lab-reset" type="button">Reset lab</button></div>
      <ol id="lab-topology" class="ccna-topology" aria-label="Lab topology"></ol>
      <div class="ccna-terminal">
        <div class="ccna-terminal-bar"><div id="lab-devices" aria-label="Select a device"></div><span>Simulated CLI</span></div>
        <pre id="lab-output" role="log" aria-label="Command output" tabindex="0"></pre>
        <form id="lab-form"><label id="lab-prompt" for="lab-input"></label><input id="lab-input" aria-label="CLI command" type="text" autocapitalize="off" autocomplete="off" spellcheck="false"><button type="submit">Run ⏎</button></form>
      </div>
      <div class="ccna-guide">
        <div class="ccna-guide-top"><p id="lab-progress" aria-live="polite"></p><button class="ccna-control" type="button" id="lab-queue">Load next command</button></div>
        <p id="lab-explanation"></p><code id="lab-next"></code>
        <details><summary>View all lab steps</summary><ol id="lab-steps"></ol></details>
      </div>
    </section>
  </div>
  <section data-panel="reference" hidden><div class="ccna-panel-heading"><h2>Command reference</h2><p>Find a command and open its lab with the prerequisites applied. Press Enter to run it.</p></div><p id="reference-count" role="status"></p><div id="ccna-reference" class="ccna-cards"></div><button id="reference-more" type="button" class="ccna-control ccna-more">Show more examples</button></section>
  <section data-panel="concepts" hidden><div class="ccna-panel-heading"><h2>Concept checks</h2><p>Choose an answer to see the reasoning. Filter by exam domain or search by topic or objective number.</p></div><p id="concept-count" role="status"></p><div id="ccna-concepts" class="ccna-cards"></div><button id="concept-more" type="button" class="ccna-control ccna-more">Show more checks</button></section>
  ${wirelessPractice()}
  <details class="ccna-sources"><summary>Coverage and references</summary><p>Aligned with the six domains of Cisco’s <a href="https://learningnetwork.cisco.com/s/ccna-exam-topics">CCNA 200-301 v1.1 blueprint</a>. Reading pointers refer to Wendell Odom’s <cite>CCNA 200-301 Official Cert Guide</cite>, Volumes 1 and 2 (Cisco Press, 2020). The practice scenarios and output are original.</p><p>The browser simulator supports the commands and example arguments in the reference for the selected lab. It models specific outcomes with abbreviated output.</p></details>
</section>`;
}
