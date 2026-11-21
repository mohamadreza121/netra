import { practiceWorkspace } from './practice-workspace.mjs';
import { labs, tracks, commandCount, conceptCount } from '../features/ccnp/catalog.mjs';

const coverage = `<section data-panel="coverage" hidden>
  <div class="ccna-panel-heading"><h2>Exam coverage</h2><p>Find the objective you’re studying and open its lab or concept check.</p></div>
  <div id="ccnp-coverage"></div>
  <details class="ccna-sources"><summary>Portable Command Guide coverage</summary><p>Explore the labs mapped to each of the 13 command-guide chapters.</p><div id="ccnp-book"></div></details>
</section>`;
const sources = `<details class="ccna-sources">
  <summary>Coverage and references</summary>
  <p>Mapped to Cisco’s <a href="${tracks[0].blueprint}">ENCOR blueprint</a> and <a href="${tracks[1].blueprint}">ENARSI blueprint</a>. The reading pointers refer to the <cite>ENCOR Official Cert Guide</cite> and the <cite>CCNP and CCIE Enterprise Core and CCNP Advanced Routing Portable Command Guide</cite>. Wireless is included as a supplement from the guides.</p>
  <p>Labs use original, guided scenarios with example arguments and simulated output. Service and controller responses are built into the exercises. Use the matching device and mode in each example.</p>
</details>`;

export function ccnpPractice({guided=false}={}) {
  return `<section class="ccna-intro ccnp-intro">
  <div class="frame">
    <p class="eyebrow">${guided?'LABSIM · GUIDED MODE':'CCNP ENTERPRISE · 350-401 + 300-410'}</p>
    <h1>${guided?'CCNP CLI Labs':'CCNP Practice'}<span>.</span></h1>
    <p>${guided?'Run configure, verify and troubleshoot sequences in prepared enterprise scenarios.':'Configure, verify and troubleshoot enterprise networks with ENCOR and ENARSI labs.'}</p>
    <div class="ccna-summary">${guided?
      '<a href="/labsim/">Open free-form LabSim</a><a href="/ccnp/#coverage">View exam coverage</a>':
      `<span><b>${labs.length}</b> guided CLI labs</span><span><b>${commandCount}</b> unique command examples</span><span><b>${conceptCount}</b> concept checks</span>`
    }</div>
  </div>
</section>
${practiceWorkspace({
  name:'CCNP practice', where:guided?'guided':'ccnp',
  trackControls:`<div class="ccnp-track" aria-label="Select a CCNP track">
    ${tracks.map(({id,title,exam})=>`<button type="button" data-track="${id}" aria-pressed="${id==='encor'}"><strong>${title}</strong><span>${exam}</span></button>`).join('')}
    <span id="ccnp-track-count" aria-live="polite"></span>
  </div>`,
  views:guided?['labs','reference']:['labs','reference','concepts','coverage'],
  extraPanel:guided?'':coverage, sources
})}`;
}
