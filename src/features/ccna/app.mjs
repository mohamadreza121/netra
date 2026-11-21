import { labs, domains } from './catalog.mjs';
import { concepts } from './concepts.mjs';
import { makeSession } from './engine.mjs';

const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
function button(text, onClick, className = 'ccna-control') {
  const element = node('button', text, className);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

const input = $('lab-input');
const output = $('lab-output');
const search = $('ccna-search');
const domainButtons = new Map();
const nav = [...document.querySelectorAll('[data-view]')];
const panels = [...document.querySelectorAll('[data-panel]')];
const viewIds = nav.map(link => link.dataset.view);
const reference = labs.flatMap(lab => {
  const seen = new Set();
  return lab.steps.flatMap(([device, command, why], index) => {
    const key = device + ' ' + command.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ lab, index, device, command, why }];
  });
});

let domain = 0;
let view = 'labs';
let current = labs.find(lab => lab.id === 'ospf');
let session;
let device;
let transcript;
let history;
let historyPosition;

function matches(...values) {
  const content = values.join(' ').toLowerCase();
  return search.value.trim().toLowerCase().split(/\s+/).every(word => content.includes(word));
}

function filterList() {
  const filtered = labs.filter(lab => (!domain || lab.domain === domain) && matches(lab.title, lab.objectives, lab.task, ...lab.steps.flatMap(step => step.slice(1, 3))));
  const items = filtered.map(lab => {
    const item = button(lab.title, () => selectLab(lab), 'ccna-lab-link');
    item.append(node('small', domains[lab.domain - 1].title));
    item.setAttribute('aria-pressed', String(lab.id === current.id));
    return item;
  });
  $('ccna-lab-list').replaceChildren(...(items.length ? items : [node('p','No matching labs.')]));
}

function showPrompt() {
  $('lab-prompt').textContent = session.prompt(device);
  for (const tab of $('lab-devices').children) tab.setAttribute('aria-pressed', String(tab.textContent === device));
}

function queueNext(focus = false) {
  const next = session.steps[session.cursor];
  if (!next) return;
  device = next.device;
  showPrompt();
  input.value = next.command;
  if (focus) input.focus();
}

function renderGuide() {
  const step = session.steps[session.cursor];
  $('lab-progress').textContent = step ? `Step ${session.cursor + 1} of ${session.steps.length} · ${step.device}` : 'Lab walkthrough complete';
  $('lab-explanation').textContent = step?.explanation ?? 'Keep experimenting with the supported commands, or reset to start again.';
  $('lab-next').textContent = step?.command ?? '';
  $('lab-next').hidden = !step;
  $('lab-queue').disabled = !step;
  for (const [index, item] of [...$('lab-steps').children].entries()) {
    item.classList.toggle('done', index < session.cursor);
    if (index === session.cursor) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
}

function selectLab(lab, startAt = 0) {
  current = lab;
  session = makeSession(lab);
  device = lab.devices[0];
  transcript = ['Netra practice console. Press Enter to run the loaded command, or type ? for available commands.'];
  history = [];
  historyPosition = 0;
  for (const step of session.steps.slice(0, startAt)) session.run(step.device, step.command);
  if (startAt) transcript.push('Prerequisite steps applied. The selected command is ready to run.');
  $('lab-title').textContent = lab.title;
  $('lab-task').textContent = lab.task;
  $('lab-objective').textContent = `${lab.objectives} · ${lab.source}`;
  $('lab-topology').replaceChildren(...lab.topology.map(label => node('li', label)));
  $('lab-devices').replaceChildren(...lab.devices.map(name => button(name, () => {
    device = name;
    input.value = '';
    showPrompt();
    input.focus();
  }, 'ccna-device')));
  $('lab-steps').replaceChildren(...session.steps.map(step => {
    const item = node('li');
    item.append(node('b', step.device), node('code', step.command));
    return item;
  }));
  output.textContent = transcript.join('\n');
  output.scrollTop = 0;
  queueNext();
  renderGuide();
  filterList();
}

$('lab-form').addEventListener('submit', event => {
  event.preventDefault();
  const command = input.value.trim();
  if (!command) return;
  const previous = session.cursor;
  const prompt = session.prompt(device);
  const result = session.run(device, command);
  transcript.push(prompt + ' ' + command, ...(result.output ? [result.output] : []));
  transcript = transcript.slice(-250);
  output.textContent = transcript.join('\n');
  output.scrollTop = output.scrollHeight;
  history.push(command);
  historyPosition = history.length;
  input.value = '';
  showPrompt();
  if (previous !== session.cursor) {
    renderGuide();
    queueNext();
  }
  input.focus({preventScroll:true});
});
input.addEventListener('keydown', event => {
  if (!['ArrowUp','ArrowDown'].includes(event.key) || !history.length) return;
  event.preventDefault();
  historyPosition = Math.min(history.length, Math.max(0, historyPosition + (event.key === 'ArrowUp' ? -1 : 1)));
  input.value = history[historyPosition] ?? '';
  input.setSelectionRange(input.value.length, input.value.length);
});
$('lab-queue').addEventListener('click', () => queueNext(true));
$('lab-reset').addEventListener('click', () => {selectLab(current); input.focus();});

function renderReference() {
  const entries = reference.filter(({lab, command, why, device}) => (!domain || lab.domain === domain) && matches(lab.title,command,why,device));
  $('reference-count').textContent = `${entries.length} matching ${entries.length === 1 ? 'example' : 'examples'}`;
  $('ccna-reference').replaceChildren(...entries.map(({lab,index,device,command,why}) => {
    const card = node('article', undefined, 'ccna-card');
    const title = node('h3');
    title.append(node('code',command));
    const preview = node('details');
    const example = node('pre');
    preview.append(node('summary','Example result'), example);
    preview.addEventListener('toggle', () => {
      if (!preview.open || example.textContent) return;
      const demo = makeSession(lab);
      for (const step of demo.steps.slice(0,index)) demo.run(step.device,step.command);
      const result = demo.run(device,command);
      example.textContent = result.output || `Returns to ${demo.prompt(device)} after applying the command.`;
    });
    card.append(node('p',`${device} · ${lab.title}`,'ccna-card-tag'),title,node('p',why),preview,
      button('Try command', () => {
        selectLab(lab,index);
        changeView('labs');
        input.focus();
      }));
    return card;
  }));
}

function renderConcepts() {
  const filtered = concepts.filter(([category,id,title,prompt,answer,alts,why]) => (!domain || domain === category) && matches(id,title,prompt,answer,...alts,why));
  $('ccna-concepts').replaceChildren(...(filtered.length ? filtered.map(([,id,title,prompt,answer,alts,why], index) => {
    const card = node('article', undefined, 'ccna-card');
    const feedback = node('p',undefined,'ccna-feedback');
    feedback.setAttribute('role','status');
    const choices = [...alts];
    choices.splice(index % 3,0,answer);
    const options = node('div',undefined,'ccna-choices');
    options.append(...choices.map(choice => button(choice, event => {
      for (const item of options.children) item.setAttribute('aria-pressed', String(item === event.currentTarget));
      const correct = choice === answer;
      feedback.dataset.result = correct ? 'correct' : 'try-again';
      feedback.textContent = (correct ? 'Correct. ' : 'Answer: ' + answer + '. ') + why;
    })));
    card.append(node('p','Objective ' + id,'ccna-card-tag'),node('h3',title),node('p',prompt),options,feedback);
    return card;
  }) : [node('p','No matching concept checks.')]));
}

function render() {
  if (view === 'labs') filterList();
  if (view === 'reference') renderReference();
  if (view === 'concepts') renderConcepts();
}
function changeView(next, updateHash = true) {
  view = viewIds.includes(next) ? next : 'labs';
  for (const link of nav) {
    if (link.dataset.view === view) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== view;
  search.disabled = view === 'wlan';
  $('ccna-domains').hidden = view === 'wlan';
  if (updateHash && location.hash !== '#' + view) window.history.pushState(null,'','#' + view);
  render();
}
for (const link of nav) link.addEventListener('click', event => {event.preventDefault();changeView(link.dataset.view);});
window.addEventListener('popstate', () => changeView(location.hash.slice(1), false));
search.addEventListener('input', render);
for (const d of [{id:0,title:'All domains'}, ...domains]) {
  const filter = button(d.title, () => {
    domain = d.id;
    for (const [id, item] of domainButtons) item.setAttribute('aria-pressed', String(id === domain));
    render();
  }, 'ccna-filter');
  filter.setAttribute('aria-pressed',String(!d.id));
  if (d.weight) filter.title = `${d.weight}% of the v1.1 exam blueprint`;
  domainButtons.set(d.id, filter);
  $('ccna-domains').append(filter);
}

let wlan;
$('wlan-form').addEventListener('submit', event => {
  event.preventDefault();
  const profile = Object.fromEntries(new FormData(event.currentTarget));
  if (profile.security !== 'Open' && profile.key.length < 8) {
    $('wlan-status').textContent = 'Use at least eight characters for the lab pre-shared key.';
    return;
  }
  delete profile.key;
  wlan = profile;
  $('wlan-status').textContent = `Applied ${wlan.ssid} · VLAN ${wlan.vlan} · ${wlan.security === 'wpa2' ? 'WPA2-Personal (AES)' : wlan.security}.`;
  $('wlan-output').textContent = 'Ready to test the client against this profile.';
});
$('wlan-connect').addEventListener('click', () => {
  let result;
  if (!wlan) result = 'Apply a profile first.';
  else if (!wlan.enabled) result = 'SSID unavailable. Enable the WLAN and apply the profile.';
  else if (wlan.security !== 'wpa2') result = 'Association failed. This client expects WPA2-Personal with AES.';
  else if (wlan.vlan !== '10') result = 'Associated, but the client cannot obtain a lease on the staff network. Check the VLAN mapping.';
  else result = `Connected to ${wlan.ssid}\nAuthentication: WPA2-PSK / AES\nClient VLAN: 10\nIPv4 lease: 192.168.10.21/24\nQoS: ${wlan.qos}`;
  $('wlan-output').textContent = result;
});

selectLab(current);
changeView(location.hash.slice(1), false);
