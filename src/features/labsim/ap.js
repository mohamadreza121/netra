import { linkUp, models, requestDhcp, wifiUp, isHost, hostIp, hostPrefix, gateway, macAddress } from './network.js';
import { integer, validVlan, reply, invalid, validIp } from './ios.js';
import { prefixLength } from './network.js';

const on = value => value?'on':'off';
const clients = (lab,d) => lab.devices.filter(x=>isHost(x)&&wifiUp(lab,x)===d);
export const apBand = device => device.radio.band??'2.4';
export const apChannel = device => device.radio.channel??(apBand(device)==='5'?36:1);
const channels = {'2.4':[1,2,3,4,5,6,7,8,9,10,11], '5':[36,40,44,48,149,153,157,161,165]};

function running(d) {
  return [`ssid "${d.radio.ssid}"`, `security ${d.radio.key?'wpa2-psk [configured]':'open'}`,
    'radio '+on(d.radio.enabled),'radio band '+apBand(d),'radio channel '+(d.radio.channel??'auto'),
    'radio width '+(d.radio.width??20),'radio power '+(d.radio.power??17),
    'ssid broadcast '+on(d.radio.broadcast!==false),'client isolation '+on(d.radio.isolation),
    ...(d.radio.vlan?['ssid vlan '+d.radio.vlan]:[]),
    'interface ethernet 0',d.ports.Eth0.up?' no shutdown':' shutdown',
    ...(d.host.ip?[' ip address '+d.host.ip+' '+d.host.prefix]:d.host.lease?[' ip address dhcp']:[]),
    ...(gateway(d)?['ip default-gateway '+gateway(d)]:[])].join('\n');
}

export function accessPoint(lab,d,args,connectivity) {
  const [cmd,action,target,extra]=args;
  const radio=d.radio;
  const c=args.join(' ').toLowerCase();
  if (cmd==='ssid'&&args.length===2) {
    if (!action||new TextEncoder().encode(action).length>32) return invalid('Use an SSID of 1–32 bytes.');
    radio.ssid=action;return reply('SSID set.');
  }
  if (cmd==='security') {
    if (action==='open') {radio.key='';return reply('Open authentication configured.');}
    if (!/^[\x20-\x7e]{8,63}$/.test(target)) return invalid('Use a WPA2 passphrase of 8–63 ASCII characters.');
    radio.key=target;return reply('WPA2-Personal configured.');
  }
  if (cmd==='radio') {
    if (['on','off'].includes(action)) {radio.enabled=action==='on';return reply('Radio '+action+'.');}
    if (action==='band') {
      if (!Object.hasOwn(channels,target)) return invalid('Use radio band 2.4 or 5.');
      if (target!==apBand(d)) {radio.band=target;delete radio.channel;radio.width=20;}
      return reply();
    }
    if (action==='channel') {
      if (target==='auto') {delete radio.channel;return reply();}
      if (!channels[apBand(d)].includes(Number(target))) return invalid('Channels for this band: '+channels[apBand(d)].join(', '));
      radio.channel=Number(target);return reply();
    }
    if (action==='width'&&(apBand(d)==='5'?[20,40,80]:[20,40]).includes(Number(target))) {radio.width=Number(target);return reply();}
    if (action==='power'&&integer(target,1,30)) {radio.power=Number(target);return reply();}
    if (action==='max-clients'&&integer(target,1,50)) {radio.maxClients=Number(target);return reply();}
    return invalid('Check the radio value. Use radio ? for available settings.');
  }
  if (c.startsWith('ssid vlan ')) {
    if (!validVlan(target)) return invalid('Use VLAN 1–4094.');
    radio.vlan=Number(target);return reply();
  }
  if (c==='no ssid vlan') {delete radio.vlan;return reply();}
  if (c.startsWith('ssid broadcast ')) {radio.broadcast=target==='on';return reply();}
  if (c.startsWith('client isolation ')) {radio.isolation=target==='on';return reply();}
  if (c==='show wireless clients') return reply(clients(lab,d).map(client=>`${client.name.padEnd(12)}${macAddress(client)}  ${hostIp(client)??'unassigned'}`).join('\n')||'No associated clients.');
  if (c.startsWith('show wireless')) return reply([
    `Radio: ${on(radio.enabled)} · ${apBand(d)} GHz · Channel ${apChannel(d)} · ${radio.width??20} MHz · ${radio.power??17} dBm`,
    `SSID: ${radio.ssid} · ${radio.broadcast===false?'hidden':'broadcast'}`,`Security: ${radio.key?'WPA2-PSK':'Open'}`,
    `Client VLAN: ${radio.vlan??'untagged'} · Isolation: ${on(radio.isolation)}`,
    `Ethernet: ${linkUp(lab,d,'Eth0')?'up':'down'}`,
    `Clients: ${clients(lab,d).map(x=>x.name).join(', ')||'none'} / ${radio.maxClients??50}`].join('\n'));
  if (c==='show running-config') return reply(running(d));
  if (c==='show startup-config') return reply(d.startup??'startup-config is not present');
  if (c==='copy running-config startup-config'||c==='write memory') {d.startup=running(d);return reply('Building configuration...\n[OK]');}
  if (c==='interface ethernet 0') return reply('Ethernet0 selected.');
  if (c==='shutdown'||c==='no shutdown') {d.ports.Eth0.up=c==='no shutdown';return reply();}
  if (c==='ip address dhcp') {
    delete d.host.ip;delete d.host.prefix;
    const result=requestDhcp(lab,d);
    return reply(result.ok?'DHCP lease: '+result.ip+' from '+result.server:result.reason,result.path);
  }
  if (c==='no ip address') {delete d.host.ip;delete d.host.prefix;delete d.host.lease;return reply();}
  if (c.startsWith('ip address ')) {
    const length=prefixLength(extra?.replace(/^\//,''));
    if (!validIp(target)||length===null||(args[4]&&!validIp(args[4]))) return invalid('Use ip address IPv4 MASK [GATEWAY].');
    Object.assign(d.host,{ip:target,prefix:length,gateway:args[4]});delete d.host.lease;return reply();
  }
  if (c.startsWith('ip default-gateway ')) {
    if (!validIp(target)) return invalid('Enter a valid IPv4 address.');
    d.host.gateway=target;return reply();
  }
  if (c==='show dhcp lease') return reply(d.host.lease?hostIp(d)+'/'+hostPrefix(d)+' via '+gateway(d):'No DHCP lease.');
  if (c.startsWith('show interfaces')||c==='show ip interface brief') return reply(`${models.ap.ports[0]}  ${hostIp(d)??'unassigned'}  ${linkUp(lab,d,'Eth0')?'up/up':d.ports.Eth0.up?'down/down':'administratively down/down'}`);
  if (cmd==='ping'||cmd==='traceroute') return connectivity(lab,d,cmd,action);
  return invalid('Check the AP arguments.');
}
