import { wirelessScenarios, wirelessConfig, apJoined, testWireless } from './wireless.mjs';

const byId = id => document.getElementById(id);

export function mountWireless(openCli) {
  const picker = byId('wlan-scenario');
  const controller = byId('wlan-form');
  const station = byId('wlan-client');
  const controls = controller.elements;
  const stationInputs = station.elements;
  const status = byId('wlan-status');
  const detail = byId('wlan-detail');
  const trace = byId('wlan-output');
  const lists = ['wlcVlans','apVlans','flexVlans','scopes','gateways'];
  const toggles = ['enabled','policyEnabled','tag','poe','controllerReachable','nearby','radius'];
  let scenario;
  let applied;

  picker.append(...wirelessScenarios.map(s => new Option(s.name,s.id)));

  function populateChannels(selected) {
    const available = controls.band.value === '2.4' ? [1,2,3,4,5,6,7,8,9,10,11] : [36,40,44,48,149,153,157,161];
    controls.channel.replaceChildren(...available.map(ch => new Option(String(ch),String(ch))));
    if (available.includes(selected)) controls.channel.value = String(selected);
  }

  function showSecurityFields(form) {
    const mode = form.elements.security.value;
    form.querySelectorAll('[data-wlan-psk]').forEach(label => {label.hidden = !['wpa2','wpa3'].includes(mode);});
    form.querySelectorAll('[data-wlan-eap]').forEach(label => {label.hidden = mode !== 'enterprise';});
  }

  function showApplied() {
    status.textContent = `AP-01 ${apJoined(applied) ? 'joined' : 'offline'} · ${applied.ssid} · VLAN ${applied.vlan}`;
  }

  function reset() {
    scenario = wirelessScenarios.find(item => item.id === picker.value);
    applied = wirelessConfig(scenario);
    byId('wlan-brief').textContent = scenario.description;
    controls.band.value = applied.band;
    populateChannels(applied.channel);
    for (const [name,value] of Object.entries(applied)) {
      if (toggles.includes(name)) controls[name].checked = value;
      else controls[name].value = Array.isArray(value) ? value.join(',') : value;
    }
    for (const [name,value] of Object.entries(scenario.client)) stationInputs[name].value = value;
    showSecurityFields(controller);
    showSecurityFields(station);
    controller.querySelector('.wlan-advanced').open = ['branch','central-trunk','dhcp-scope','rf','enterprise'].includes(scenario.id);
    showApplied();
    detail.textContent = 'Test the client to locate the first failing stage.';
    trace.replaceChildren();
  }

  controls.band.addEventListener('change', () => populateChannels());
  for (const form of [controller,station]) form.elements.security.addEventListener('change', () => showSecurityFields(form));
  picker.addEventListener('change',reset);
  byId('wlan-reset').addEventListener('click',reset);
  byId('wlan-cli').addEventListener('click',openCli);

  controller.addEventListener('submit',event => {
    event.preventDefault();
    const next = Object.fromEntries(new FormData(controller));
    next.ssid = next.ssid.trim();
    if (!next.ssid || new TextEncoder().encode(next.ssid).length > 32) {
      status.textContent = 'Enter an SSID of 1–32 bytes.';
      return;
    }
    if (['wpa2','wpa3'].includes(next.security) && !/^[\x20-\x7e]{8,63}$/.test(next.key)) {
      status.textContent = 'Use 8–63 printable ASCII characters for the lab passphrase.';
      return;
    }
    for (const field of lists) {
      const tokens = next[field].split(',').map(v=>v.trim()).filter(Boolean);
      if (tokens.some(v=>!/^\d+$/.test(v) || Number(v)<1 || Number(v)>4094)) {
        status.textContent = 'Enter comma-separated VLAN IDs from 1 to 4094.';
        controls[field].focus();
        return;
      }
      next[field] = [...new Set(tokens.map(Number))];
    }
    for (const field of toggles) next[field] = controls[field].checked;
    for (const field of ['channel','vlan','apNative']) next[field] = Number(next[field]);
    applied = next;
    showApplied();
    detail.textContent = 'Changes applied. Rerun the client test.';
    trace.replaceChildren();
  });

  station.addEventListener('submit',event => {
    event.preventDefault();
    const client = Object.fromEntries(new FormData(station));
    const result = testWireless(applied,client,scenario);
    detail.textContent = result.success ? 'Scenario complete.' : result.events.some(e=>e.state==='fail') ? 'Follow the trace to the first failed stage.' : 'Client connected. Check the remaining scenario requirement.';
    trace.replaceChildren(...result.events.map(event => {
      const row = document.createElement('li');
      row.dataset.state = event.state;
      const stage = document.createElement('b');
      stage.textContent = event.stage + ' · ' + {pass:'OK',warn:'Check',fail:'Failed'}[event.state];
      const message = document.createElement('span');
      message.textContent = event.detail;
      row.append(stage,message);
      return row;
    }));
  });

  reset();
}
