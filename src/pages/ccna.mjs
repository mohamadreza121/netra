import { practiceWorkspace } from './practice-workspace.mjs';
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
${practiceWorkspace({
  name:'CCNA practice',
  extraView:'<a href="#wlan" data-view="wlan">Wireless lab</a>',
  extraPanel:wirelessPractice(),
  sources:`<details class="ccna-sources"><summary>Coverage and references</summary><p>Aligned with the six domains of Cisco’s <a href="https://learningnetwork.cisco.com/s/ccna-exam-topics">CCNA 200-301 v1.1 blueprint</a>. Reading pointers refer to Wendell Odom’s <cite>CCNA 200-301 Official Cert Guide</cite>, Volumes 1 and 2 (Cisco Press, 2020). The practice scenarios and output are original.</p><p>The browser simulator supports the commands and example arguments in the reference for the selected lab. It models specific outcomes with abbreviated output.</p></details>`
})}`;
}
