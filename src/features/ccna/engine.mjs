const navigation = new Set(['enable', 'disable', 'configure terminal', 'exit', 'end']);
const aliases = new Map([['en', 'enable'], ['conf t', 'configure terminal'], ['sh run', 'show running-config'], ['wr', 'write memory']]);
const childMode = /^(interface(?: range)?|router ospf|vlan|line|ip access-list (?:standard|extended)|ip dhcp pool|policy-map|class-map|class) /;
const suffix = mode => {
  if (mode.startsWith('interface')) return 'config-if';
  if (mode.startsWith('router')) return 'config-router';
  if (mode.startsWith('line')) return 'config-line';
  if (mode.startsWith('ip access-list standard')) return 'config-std-nacl';
  if (mode.startsWith('ip access-list')) return 'config-ext-nacl';
  if (mode.startsWith('ip dhcp')) return 'dhcp-config';
  if (mode.startsWith('vlan ')) return 'config-vlan';
  return 'config';
};

const normalize = input => {
  const line = input.trim().toLowerCase().replace(/\s+/g, ' ');
  return aliases.get(line) ?? line;
};

function nextMode(mode, command) {
  if (command === 'enable' && mode === 'user') return 'exec';
  if (command === 'disable' && mode === 'exec') return 'user';
  if (command === 'configure terminal' && mode === 'exec') return 'global';
  if (command === 'exit' && mode === 'global') return 'exec';
  if (command === 'exit' && !['user', 'exec', 'host'].includes(mode)) return 'global';
  if (command === 'end' && !['user', 'exec', 'host'].includes(mode)) return 'exec';
  return navigation.has(command) ? null : childMode.test(command) ? command : mode;
}

export function makeSession(lab) {
  const initial = Object.fromEntries(lab.devices.map(id => [id, id.startsWith('PC') ? 'host' : 'user']));
  const recipeModes = { ...initial };
  const steps = lab.steps.map(([device, command, explanation, action], index) => {
    const key = normalize(command);
    const mode = recipeModes[device];
    recipeModes[device] = nextMode(mode, key) ?? mode;
    return { device, command, key, mode, explanation, action, index };
  });
  const state = structuredClone(lab.initial ?? {});
  const modes = { ...initial };
  const config = Object.fromEntries(lab.devices.map(id => [id, new Map()]));
  const startup = {};
  let cursor = 0;

  const accepted = (device, command, mode) => steps.find(s => s.device === device && s.key === command && s.mode === mode);
  const configured = (mode) => !['host', 'user', 'exec'].includes(mode);
  const showConfig = device => {
    const lines = [];
    for (const [context, commands] of config[device]) {
      if (context !== 'global') lines.push(context);
      lines.push(...[...commands.values()].map(line => (context === 'global' ? '' : ' ') + line));
    }
    return lines.join('\n') || '(no changes in this lab)';
  };

  function prompt(device) {
    const label = state['hostname:' + device] ?? device;
    const mode = modes[device];
    if (mode === 'host' || mode === 'user') return label + '>';
    if (mode === 'exec') return label + '#';
    return `${label}(${suffix(mode)})#`;
  }

  function run(device, input) {
    const raw = input.trim();
    const key = normalize(raw);
    const mode = modes[device];
    if (!key) return { ok: false, output: '' };
    const doShow = key.startsWith('do ') && configured(mode);
    const command = doShow ? key.slice(3) : key;
    const lookupMode = doShow ? 'exec' : mode;
    const direct = accepted(device, command, lookupMode);
    if (key === '?' || key === 'help') {
      const supported = [...new Set(steps.filter(s => s.device === device && s.mode === mode).map(s => s.command))];
      return { ok: true, output: [...supported, ...(configured(mode) ? ['exit', 'end', 'do show running-config'] : mode === 'exec' ? ['show running-config', 'show startup-config', 'copy running-config startup-config'] : [])].filter((v, i, arr) => arr.indexOf(v) === i).join('\n') || 'Switch to the device shown in the lesson.' };
    }

    let output = '';
    if (navigation.has(key)) {
      const next = nextMode(mode, key);
      if (!next) return { ok: false, output: '% Command unavailable in this mode.' };
      modes[device] = next;
      if (key === 'configure terminal') output = 'Enter configuration commands, one per line. End with CNTL/Z.';
    } else if (command === 'show running-config' && lookupMode === 'exec') {
      output = showConfig(device);
    } else if (command === 'show startup-config' && lookupMode === 'exec') {
      output = startup[device] ?? 'startup-config is not present';
    } else if (['copy running-config startup-config', 'write memory'].includes(command) && lookupMode === 'exec') {
      startup[device] = showConfig(device);
      output = 'Building configuration...\n[OK]';
    } else if (direct) {
      const result = direct.action?.(state, device);
      if (result?.error) return { ok: false, output: result.error };
      output = result ?? '';
      if (configured(mode) && !doShow) {
        const next = nextMode(mode, key);
        modes[device] = next;
        if (next !== mode) {
          if (!config[device].has(next)) config[device].set(next, new Map());
        } else {
          const commands = config[device].get(mode) ?? new Map();
          if (key.startsWith('no ') && commands.has(key.slice(3))) commands.delete(key.slice(3));
          else commands.set(key, raw);
          config[device].set(mode, commands);
        }
      }
    } else {
      const known = steps.some(s => s.device === device && s.key === command);
      return { ok: false, output: known ? '% This command belongs in a different CLI mode. Enter ? for available commands.' : '% Command unavailable in this lab. Enter ? for supported commands in this mode.' };
    }

    const expected = steps[cursor];
    if (expected?.device === device && expected.key === key && expected.mode === mode) cursor++;
    return { ok: true, output };
  }

  return { state, steps, run, prompt, get cursor() { return cursor; }, config: showConfig };
}

export const set = (key, value) => state => { state[key] = value; };
export const change = values => state => { Object.assign(state, values); };
export const read = report => state => report(state);
export const field = (state, key, fallback = '—') => state[key] ?? fallback;
export const lines = (...rows) => rows.join('\n');
