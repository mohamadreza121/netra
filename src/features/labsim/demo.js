const devices = {
  R1: {
    ports: ['Gi0/0 · 192.168.10.1/24 · Up', 'Gi0/1 · Unassigned · Administratively down', 'Expansion bay · Empty'],
    commands: {
      'show ip interface brief': 'Interface    IP-Address       Status      Protocol\nGi0/0        192.168.10.1     up          up\nGi0/1        unassigned       admin down  down',
      'show ip route': 'C  192.168.10.0/24 directly connected, Gi0/0\nL  192.168.10.1/32 directly connected, Gi0/0'
    }
  },
  SW1: {
    ports: ['Gi0/1 · VLAN 10 · Up', 'Gi0/2 · VLAN 10 · Up', 'SFP uplink bay · Empty'],
    commands: {
      'show vlan brief': 'VLAN Name       Status   Ports\n1    default    active\n10   STAFF      active   Gi0/1, Gi0/2',
      'show interfaces status': 'Port      Status       VLAN\nGi0/1     connected    10\nGi0/2     connected    10'
    }
  },
  PC1: {
    ports: ['Eth0 · 192.168.10.24/24 · Up'],
    commands: { ipconfig: 'IPv4 Address      192.168.10.24\nSubnet Mask       255.255.255.0\nDefault Gateway   192.168.10.1' }
  }
};

const buttons = [...document.querySelectorAll('[data-device]')];
const title = document.querySelector('#inspector-title');
const ports = document.querySelector('#device-ports');
const consoleDevice = document.querySelector('#console-device');
const prompt = document.querySelector('#console-prompt');
const output = document.querySelector('#console-output');
const input = document.querySelector('#console-input');
const form = document.querySelector('#console-form');
const histories = new Map();
let active = 'R1';

function selectDevice(id) {
  active = id;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.device === id));
  title.textContent = `${id} ports and modules`;
  ports.replaceChildren(...devices[id].ports.map(port => {
    const item = document.createElement('li');
    item.textContent = port;
    return item;
  }));
  consoleDevice.textContent = id;
  prompt.textContent = id + (id === 'PC1' ? '>' : '#');
  output.textContent = histories.get(id) ?? 'Type help to see available commands.';
  output.scrollTop = output.scrollHeight;
  input.value = '';
}

buttons.forEach(button => button.addEventListener('click', () => selectDevice(button.dataset.device)));
form.addEventListener('submit', event => {
  event.preventDefault();
  const entered = input.value.trim();
  if (!entered) return;
  const command = entered.toLowerCase().replace(/\s+/g, ' ');
  const commands = devices[active].commands;
  const response = command === 'help' ? Object.keys(commands).join('\n') : Object.hasOwn(commands, command) ? commands[command] : 'Command unavailable in this preview. Type help for the supported commands.';
  output.textContent += `\n\n${prompt.textContent} ${entered}\n${response}`;
  histories.set(active, output.textContent);
  output.scrollTop = output.scrollHeight;
  input.value = '';
  input.focus();
});
selectDevice(active);
