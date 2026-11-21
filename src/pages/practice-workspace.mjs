export function practiceWorkspace({name,trackControls='',extraView='',extraPanel='',sources='',views=['labs','reference','concepts'],where='practice'}) {
  const labels={labs:'CLI labs',reference:'Command reference',concepts:'Concept checks',coverage:'Exam coverage'};
  return `<section class="ccna-workspace frame" aria-label="${name} workspace" data-practice="${where}">
  ${trackControls}
  <div class="ccna-toolbar">
    <nav class="ccna-views" aria-label="Practice views">
      ${views.map(view=>`<a href="#${view}" data-view="${view}"${view==='labs'?' aria-current="page"':''}>${labels[view]}</a>`).join('')}
      ${extraView}
    </nav>
    <label class="ccna-search" for="ccna-search"><span>Search topics and commands</span><input id="ccna-search" type="search" placeholder="${name.startsWith('CCNP')?'Try BGP, VRF, or show dmvpn':'Try OSPF, trunk, or show ip route'}"></label>
  </div>
  <div class="ccna-domains" id="ccna-domains" aria-label="Exam domains"></div>
  <div data-panel="labs" class="ccna-labs">
    <aside class="ccna-lab-list"><h2>Lab library</h2><div id="ccna-lab-list"></div></aside>
    <section class="ccna-active-lab" aria-label="Selected lab">
      <div class="ccna-lab-heading"><div><p id="lab-objective" class="eyebrow"></p><h2 id="lab-title"></h2><p id="lab-task"></p></div><div class="practice-lab-actions"><a class="ccna-control" id="lab-open" hidden>Open in LabSim</a><button class="ccna-control" id="lab-reset" type="button">Reset lab</button></div></div>
      <ol id="lab-topology" class="ccna-topology" aria-label="Lab topology"></ol>
      <div class="ccna-terminal">
        <div class="ccna-terminal-bar"><div id="lab-devices" aria-label="Select a device"></div><span>${where==='guided'?'LabSim · Guided CLI':'Simulated CLI'}</span></div>
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
  ${views.includes('concepts')?'<section data-panel="concepts" hidden><div class="ccna-panel-heading"><h2>Concept checks</h2><p>Choose an answer to see the reasoning. Filter by exam domain or search by topic or objective number.</p></div><p id="concept-count" role="status"></p><div id="ccna-concepts" class="ccna-cards"></div><button id="concept-more" type="button" class="ccna-control ccna-more">Show more checks</button></section>':''}
  ${extraPanel}
  ${sources}
</section>`;
}
