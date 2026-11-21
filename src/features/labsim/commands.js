import { compile } from './grammar.js';

const operational = [
  'show interfaces [<interface...>]', 'show interfaces status', 'show interfaces description',
  'show ip interface brief', 'show ip interface [<interface...>]', 'show ip arp [<address>]', 'show arp [<address>]',
  'show version', 'show clock', 'show history', 'show cdp', 'show cdp neighbors [detail]',
  'show lldp', 'show lldp neighbors [detail]', 'ping <address>', 'traceroute <address>'
];
const privileged = [
  ...operational, 'configure terminal', 'disable', 'show running-config', 'show running-config interface <interface...>', 'show startup-config',
  'copy running-config startup-config', 'write memory', 'terminal length <lines>',
  'clear arp-cache', 'clear ip arp [<address>]'
];
const deviceExec = {
  router:['show ip route','show ip route connected','show ip route local','show ip route static','show ip route ospf','show ip route <address>',
    'show ip protocols','show ip ospf','show ip ospf neighbor [detail]','show ip ospf interface brief','show ip ospf interface [<interface...>]',
    'show ip ospf database','show ip dhcp binding [<address>]','show ip dhcp pool [<name>]','clear ip dhcp binding <address-or-*>',
    'show access-lists [<name>]','show ip access-lists [<name>]','show ipv6 interface brief','show ipv6 interface [<interface...>]',
    'show ip nat translations [verbose]','show ip nat statistics','clear ip nat translation *',
    'show ipv6 route','show ipv6 route connected','show ipv6 route local','show ipv6 route static','show ipv6 neighbors'],
  switch:['show ip route','show ip route connected','show ip route static','show ip route <address>','show vlan','show vlan brief','show vlan id <vlan>','show vlan name <name>','show interfaces trunk','show interfaces switchport',
    'show interfaces <interface> switchport','show interfaces <interface> status','show interfaces <interface> trunk',
    'show interfaces vlan <vlan>','show spanning-tree','show spanning-tree summary','show spanning-tree vlan <vlan> [root]','show spanning-tree root',
    'show etherchannel summary','show etherchannel <group> summary','show port-security','show port-security interface <interface...>',
    'show ip dhcp snooping','show ip dhcp snooping statistics','show ip dhcp snooping binding','show ip arp inspection','show ip arp inspection statistics','show mac address-table','show mac address-table count','show mac address-table dynamic',
    'show mac address-table dynamic vlan <vlan>','show mac address-table dynamic interface <interface>','show mac address-table dynamic address <mac>',
    'show mac address-table static','show mac address-table secure','clear mac address-table dynamic']
};
const global = [
  'hostname <name>','interface <interface...>','no interface <interface...>','default interface <interface...>',
  'cdp run','no cdp run','lldp run','no lldp run','ip routing','no ip routing'
];
const deviceGlobal = {
  router:['ip route <network> <mask> <next-hop> [<distance>]','no ip route <network> <mask> <next-hop> [<distance>]',
    'ip dhcp excluded-address <first> [<last>]','no ip dhcp excluded-address <first> [<last>]','ip dhcp pool <name>','no ip dhcp pool <name>',
    'service dhcp','no service dhcp','router ospf <process>','no router ospf <process>',
    'ip access-list standard <name>','ip access-list extended <name>','no ip access-list standard <name>','no ip access-list extended <name>',
    'access-list <number> <rule...>','no access-list <number>','ipv6 unicast-routing','no ipv6 unicast-routing',
    'ipv6 route <prefix> <next-hop> [<distance>]','no ipv6 route <prefix> <next-hop> [<distance>]',
    'ip nat inside source static <local> <global>','no ip nat inside source static <local> <global>',
    'ip nat pool <name> <first> <last> netmask <mask>','ip nat pool <name> <first> <last> prefix-length <length>','no ip nat pool <name>',
    'ip nat inside source list <list> pool <name> [overload]','no ip nat inside source list <list> pool <name> [overload]',
    'ip nat inside source list <list> interface <port> overload','no ip nat inside source list <list> interface <port> overload'],
  switch:['ip route <network> <mask> <next-hop> [<distance>]','no ip route <network> <mask> <next-hop> [<distance>]','vlan <id>','no vlan <id>','ip default-gateway <address>','no ip default-gateway','interface range <interfaces...>',
    'spanning-tree mode pvst','spanning-tree mode rapid-pvst','spanning-tree mode mst','spanning-tree vlan <vlan> priority <priority>',
    'spanning-tree vlan <vlan> root primary','spanning-tree vlan <vlan> root secondary','spanning-tree portfast default',
    'no spanning-tree portfast default','spanning-tree portfast bpduguard default','no spanning-tree portfast bpduguard default','ip dhcp snooping','no ip dhcp snooping',
    'ip dhcp snooping vlan <vlans>','no ip dhcp snooping vlan <vlans>','ip arp inspection vlan <vlans>','no ip arp inspection vlan <vlans>']
};
const port = ['shutdown','no shutdown','description <text...>','no description','speed <rate>','duplex auto','duplex full','duplex half',
  'cdp enable','no cdp enable','lldp transmit','no lldp transmit','lldp receive','no lldp receive'];
const devicePort = {
  router:['ip address <address> <mask>','no ip address','ip nat inside','no ip nat inside','ip nat outside','no ip nat outside','ip helper-address <address>','no ip helper-address <address>',
    'encapsulation dot1q <vlan> [native]','no encapsulation dot1q',
    'ip ospf <process> area <area>','ip ospf cost <cost>','ip ospf hello-interval <seconds>','ip ospf dead-interval <seconds>',
    'ip ospf priority <priority>','ip ospf network broadcast','ip ospf network point-to-point','bandwidth <kbps>',
    'ip access-group <list> in','ip access-group <list> out','no ip access-group <list> in','no ip access-group <list> out',
    'ipv6 address <prefix> [link-local]','no ipv6 address <prefix>','ipv6 enable','no ipv6 enable'],
  switch:['switchport','no switchport','switchport mode access','switchport mode trunk','switchport access vlan <id>','no switchport access vlan',
    'switchport voice vlan <id>','no switchport voice vlan','switchport trunk native vlan <id>','no switchport trunk native vlan',
    'switchport trunk allowed vlan <list>','switchport trunk allowed vlan all','switchport trunk allowed vlan none',
    'switchport trunk allowed vlan add <list>','switchport trunk allowed vlan remove <list>','switchport trunk allowed vlan except <list>',
    'no switchport trunk allowed vlan','switchport nonegotiate','no switchport nonegotiate','ip address <address> <mask>','no ip address',
    'spanning-tree portfast [disable]','no spanning-tree portfast','spanning-tree bpduguard enable','spanning-tree bpduguard disable',
    'spanning-tree cost <cost>','spanning-tree port-priority <priority>','spanning-tree vlan <vlan> cost <cost>','spanning-tree vlan <vlan> port-priority <priority>',
    'channel-group <group> mode active','channel-group <group> mode passive','channel-group <group> mode desirable',
    'ip dhcp snooping trust','no ip dhcp snooping trust','ip arp inspection trust','no ip arp inspection trust',
    'channel-group <group> mode auto','channel-group <group> mode on','no channel-group',
    'switchport port-security','no switchport port-security','switchport port-security maximum <count>',
    'switchport port-security violation protect','switchport port-security violation restrict','switchport port-security violation shutdown',
    'switchport port-security mac-address sticky','no switchport port-security mac-address sticky',
    'switchport port-security mac-address <mac>','no switchport port-security mac-address <mac>']
};

const modePatterns = (type,mode) => {
  const exec = [...privileged,...deviceExec[type]];
  const config = ['exit','end',...exec.filter(command=>command.startsWith('show ')||command.startsWith('ping ')||command.startsWith('traceroute ')).map(command=>'do '+command)];
  switch (mode) {
    case 'user': return ['enable',...operational,...deviceExec[type].filter(command=>command.startsWith('show '))];
    case 'exec': return exec;
    case 'global': return [...config,...global,...deviceGlobal[type]];
    case 'interface': return [...config,...port,...devicePort[type]];
    case 'range': return [...config,...port,...devicePort.switch.filter(command=>!command.startsWith('ip address')&&command!=='no ip address')];
    case 'vlan': return [...config,'name <name...>','shutdown','no shutdown'];
    case 'pool': return [...config,'network <network> <mask>','default-router <address>','dns-server <address>','domain-name <domain>','lease <days> [<hours>] [<minutes>]'];
    case 'ospf': return [...config,'router-id <address>','network <network> <wildcard> area <area>','no network <network> <wildcard> area <area>',
      'passive-interface default','passive-interface <interface...>','no passive-interface default','no passive-interface <interface...>',
      'auto-cost reference-bandwidth <mbps>','default-information originate [always]','no default-information originate','maximum-paths <count>'];
    case 'acl': return [...config,'permit <rule...>','deny <rule...>','remark <text...>','<sequence> <rule...>','no <sequence>'];
    default: return [];
  }
};

const host = ['ipconfig [/all]','ipconfig /renew','ipconfig /release','ip address <ip> <prefix> [<gateway>]',
  'ping <address>','tracert <address>','traceroute <address>','wifi scan','wifi join <ssid> [<key>]','wifi status','wifi leave'];
const accessPoint = [
  'ssid <name>','security wpa2-psk <key>','security open','radio on','radio off','radio band <frequency>',
  'radio channel <channel>','radio channel auto','radio width <mhz>','radio power <dbm>','radio max-clients <count>',
  'ssid broadcast on','ssid broadcast off','ssid vlan <vlan>','no ssid vlan','client isolation on','client isolation off',
  'show wireless','show wireless clients','show wireless radio','show wireless ssid','show interfaces','show interfaces status',
  'show running-config','show startup-config','copy running-config startup-config','write memory',
  'interface ethernet 0','shutdown','no shutdown','ip address <address> <mask> [<gateway>]','ip address dhcp','no ip address',
  'ip default-gateway <address>','show ip interface brief','show dhcp lease','ping <address>','traceroute <address>'
];
const modes = ['user','exec','global','interface','range','vlan','pool','ospf','acl'];
export const commandSets = Object.fromEntries(
  ['router','switch'].map(type=>[type,Object.fromEntries(modes.map(mode=>[mode,modePatterns(type,mode)]))])
);
Object.assign(commandSets,{ap:{endpoint:accessPoint},pc:{endpoint:host},phone:{endpoint:[...host,'show phone','extension <number>','dial <number>']}});
export const filterGrammar = compile(['include <text...>','exclude <text...>','begin <text...>','section <text...>','interface <interface...>']);
export const grammars = Object.fromEntries(Object.entries(commandSets).map(([type,modes])=>
  [type,Object.fromEntries(Object.entries(modes).map(([mode,commands])=>[mode,compile(commands)]))]));
