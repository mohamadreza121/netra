import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { home } from '../src/pages/home.mjs';
import { rackHero } from '../src/pages/rack-hero.mjs';
import { ccnaPractice } from '../src/pages/ccna.mjs';
import { ccnpPractice } from '../src/pages/ccnp.mjs';
import { lab } from '../src/pages/lab.mjs';
import { layout } from '../src/layout.mjs';

const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const folder of ['styles', 'assets', 'features/labsim', 'features/ccna', 'features/ccnp', 'features/practice']) {
  await cp(new URL('../src/' + folder, import.meta.url), new URL(folder, output), { recursive: true });
}
await cp(new URL('../src/motion.js', import.meta.url), new URL('motion.js', output));
const routes = [
  ['','Home',home(),rackHero()],
  ['ccna','CCNA Practice',ccnaPractice()],
  ['ccnp','CCNP Practice',ccnpPractice()],
  ['labsim','LabSim',lab()],
  ['labsim/ccnp','LabSim · CCNP CLI Labs',ccnpPractice({guided:true})]
];
for (const [route, title, content, intro] of routes) {
  const dir = new URL(route ? route + '/' : './', output);
  await mkdir(dir, {recursive:true});
  await writeFile(new URL('index.html', dir), layout({route,title,content,intro}));
}
