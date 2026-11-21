import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, prompt, terminalSession } from '../src/features/labsim/cli.js';
import { addDevice, addLink, branchLab, emptyLab, endpoint, models, removeDevice, restoreLab } from '../src/features/labsim/network.js';

function terminal(lab, device) {
  const session = terminalSession(device);
  return (...commands) => commands.map(command => execute(lab, device, session, command).text).at(-1);
}

function cable(lab, a, portA, b, portB) {
  addLink(lab, endpoint(a, portA), endpoint(b, portB));
}

test('each device type has ten slots and Ethernet ports accept one cable', () => {
  const lab = emptyLab();
  for (const type of Object.keys(models)) {
    for (let i = 0; i < 10; i++) addDevice(lab, type);
    assert.throws(() => addDevice(lab, type), /Limit reached/);
  }
  assert.equal(lab.devices.length, 50);
  const first = lab.devices[0];
  const sw = lab.devices[10];
  cable(lab, first, 'Gi0/0', sw, 'Gi0/1');
  assert.throws(() => cable(lab, lab.devices[1], 'Gi0/0', sw, 'Gi0/1'), /already has a cable/);
  removeDevice(lab, first.id);
  const replacement = addDevice(lab, first.type);
  assert.equal(replacement.slot, first.slot);
  assert.notEqual(replacement.id, first.id);
  assert.equal(lab.links.length, 0);
});

test('inter-VLAN traffic reacts to port shutdown and trunk VLAN changes', () => {
  const lab = branchLab();
  const [, sw, pc] = lab.devices;
  const cli = terminal(lab, sw);
  const ping = terminal(lab, pc);
  const command = 'ping 192.168.20.21';
  assert.match(ping(command), /100 percent.*\nPath: PC1 → SW1 → R1 → SW1 → TEL1/);
  cli('enable', 'configure terminal', 'INTERFACE gi0/3', 'shutdown');
  assert.match(ping(command), /0 percent/);
  cli('no shutdown');
  assert.match(ping(command), /100 percent/);
  cli('exit', 'interface gi0/1', 'switchport trunk allowed vlan remove 20');
  assert.match(ping(command), /0 percent/);
  cli('switchport trunk allowed vlan add 20', 'end');
  assert.match(cli('show interfaces trunk'), /10,20/);
  assert.match(ping(command), /100 percent/);
});

test('Wi-Fi association checks the key and DHCP uses the bridged wired VLAN', () => {
  const lab = branchLab();
  const ap = lab.devices.find(device => device.type === 'ap');
  const laptop = addDevice(lab, 'pc');
  const cli = terminal(lab, laptop);
  assert.match(cli('wifi scan'), /Netra-Staff.*WPA2-PSK/);
  assert.match(cli('wifi join Netra-Staff wrong'), /Association failed/);
  assert.match(cli('ipconfig /renew'), /No DHCP offer/);
  assert.match(cli('wifi join Netra-Staff NetraLab26'), /Associated/);
  assert.match(cli('ipconfig /renew'), /192\.168\.10\.22 from R1/);
  assert.match(cli('ping 192.168.10.1'), /100 percent.*\nPath: PC2 → AP1 → SW1 → R1/);
  terminal(lab, ap)('radio off');
  assert.match(cli('ping 192.168.10.1'), /0 percent/);
});

test('static routes require IPv4 reachability in both directions', () => {
  const lab = emptyLab();
  const [r1, r2, pc1, pc2] = ['router', 'router', 'pc', 'pc'].map(type => addDevice(lab, type));
  cable(lab, pc1, 'Eth0', r1, 'Gi0/0');
  cable(lab, r1, 'Gi0/1', r2, 'Gi0/1');
  cable(lab, r2, 'Gi0/0', pc2, 'Eth0');
  const a = terminal(lab, r1), b = terminal(lab, r2), pc = terminal(lab, pc1);
  const configure = (cli, lan, transit) => cli('en', 'conf t', 'interface Gi0/0', 'ip address '+lan+' 24', 'no shutdown', 'exit', 'interface Gi0/1', 'ip address '+transit+' 30', 'no shutdown', 'exit');
  configure(a, '192.0.2.1', '10.0.0.1');
  configure(b, '198.51.100.1', '10.0.0.2');
  pc('ip address 192.0.2.2 24 192.0.2.1');
  terminal(lab, pc2)('ip address 198.51.100.2 24 198.51.100.1');
  a('ip route 198.51.100.0 24 10.0.0.2');
  assert.match(pc('ping 198.51.100.2'), /No return path/);
  b('ip route 192.0.2.0 24 10.0.0.1');
  assert.match(pc('ping 198.51.100.2'), /100 percent.*\nPath: PC1 → R1 → R2 → PC2/);
  b('NO IP ROUTE 192.0.2.0 24 10.0.0.1');
  assert.match(pc('ping 198.51.100.2'), /No return path/);
});

test('phones use the voice VLAN and calls depend on network reachability', () => {
  const lab = branchLab();
  const [, sw, , phone] = lab.devices;
  const phone2 = addDevice(lab, 'phone');
  cable(lab, phone2, 'Eth0', sw, 'Gi0/5');
  terminal(lab, sw)('enable', 'conf t', 'interface gi0/5', 'switchport access vlan 10', 'switchport voice vlan 20');
  assert.match(terminal(lab, phone2)('extension 2002', 'ipconfig /renew'), /192\.168\.20\.22/);
  const cli = terminal(lab, phone);
  assert.match(cli('dial 2002'), /Call connected \(simulated\)/);
  removeDevice(lab, phone2.id);
  assert.match(cli('dial 2002'), /No callable extension/);
});

test('saved workspace preserves the running topology and startup config', () => {
  const lab = branchLab();
  const [r] = lab.devices;
  const session = terminalSession(r);
  assert.equal(prompt(r, session), 'R1>');
  terminal(lab, r)('enable', 'copy running-config startup-config');
  const restored = restoreLab(JSON.stringify(lab));
  const [router, , pc] = restored.devices;
  assert.match(terminal(restored, router)('enable', 'show startup-config'), /encapsulation dot1Q 20/);
  assert.match(terminal(restored, pc)('ping 192.168.20.21'), /100 percent/);
  restored.links[0].a.device = 'n99';
  assert.throws(() => restoreLab(JSON.stringify(restored)), /physical Ethernet ports/);
});
