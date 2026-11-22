const modes = [
  [/^address-family /, 'config-router-af', 'exit-address-family'],
  [/^af-interface /, 'config-router-af-interface', 'exit-af-interface'],
  [/^topology base$/, 'config-router-af-topology', 'exit-af-topology'],
  [/^template peer-policy /, 'config-router-pt', 'exit-peer-policy'],
  [/^template peer-session /, 'config-router-stmp', 'exit-peer-session'],
  [/^(?:ipv6 )?router /, 'config-router'],
  [/^interface /, 'config-if'],
  [/^vlan configuration /, 'config-vlan-config'],
  [/^vlan /, 'config-vlan'],
  [/^spanning-tree mst configuration$/, 'config-mst'],
  [/^route-map /, 'config-route-map'],
  [/^key chain /, 'config-keychain'],
  [/^key /, 'config-keychain-key'],
  [/^line /, 'config-line'],
  [/^(ip|ipv6) access-list /, 'config-acl'],
  [/^ip dhcp pool /, 'dhcp-config'],
  [/^telephony-service$/, 'config-telephony'],
  [/^ephone-dn /, 'config-ephone-dn'],
  [/^ephone /, 'config-ephone'],
  [/^ipv6 dhcp pool /, 'config-dhcpv6'],
  [/^ip sla /, 'config-ip-sla'],
  [/^track /, 'config-track'],
  [/^time-range /, 'config-time-range'],
  [/^flow record /, 'config-flow-record'],
  [/^flow exporter /, 'config-flow-exporter'],
  [/^flow monitor /, 'config-flow-monitor'],
  [/^class-map /, 'config-cmap'],
  [/^policy-map /, 'config-pmap'],
  [/^class /, 'config-pmap-c'],
  [/^control-plane$/, 'config-cp'],
  [/^telemetry ietf subscription /, 'config-mdt-subs'],
  [/^monitor session .* type erspan/, 'config-mon-erspan-src'],
  [/^destination$/, 'config-mon-erspan-src-dst'],
  [/^event manager applet /, 'config-applet'],
  [/^(?:ip )?vrf definition |^ip vrf /, 'config-vrf'],
  [/^crypto ikev2 (?:proposal|policy|keyring|profile) /, 'config-ikev2'],
  [/^peer /, 'config-ikev2-keyring-peer'],
  [/^crypto ipsec (?:profile|transform-set) /, 'config-ipsec'],
  [/^crypto (?:map|isakmp policy) /, 'config-crypto'],
  [/^router lisp$/, 'config-router-lisp'],
  [/^locator-set /, 'config-router-lisp-locator-set'],
  [/^l2vpn evpn instance /, 'config-evpn-evi'],
  [/^member vni /, 'config-if-nve-vni'],
  [/^(?:tacacs|radius) server /, 'config-sg-server'],
  [/^aaa group server /, 'config-sg'],
  [/^ipv6 (?:nd raguard|dhcp guard|snooping) policy /, 'config-ipv6-policy'],
  [/^wlan /, 'config-wlan'],
  [/^wireless (?:profile|tag) /, 'config-wireless-profile']
];

export const modeFor = context => modes.find(([pattern]) => pattern.test(context.toLowerCase()));
export const scope = (level, path = []) => ({ level, path });
export const addressOf = ({level, path}) => [level, ...path].join('\u0000');
export function labelMode(mode) {
  if (mode.level === 'host') return 'Host shell';
  if (mode.level === 'rommon') return 'ROM monitor';
  if (mode.level === 'tcl') return 'Tcl interpreter';
  if (mode.level === 'user') return 'User EXEC';
  if (mode.level === 'exec') return 'Privileged EXEC';
  return mode.path.at(-1) ?? 'Global configuration';
}

export const configure = (device, path, entries) => ({device, entries, mode:scope('config',path)});
export const config = (device, entries) => configure(device, [], entries);
export const exec = (device, entries) => ({device, entries, mode:scope('exec')});
export const shell = (device, entries) => ({device, entries, mode:scope('host')});
export const tcl = (device, entries) => ({device, entries, mode:scope('tcl')});
export const rommon = (device, entries) => ({device, entries, mode:scope('rommon')});

export const assign = values => state => Object.assign(state, values);
export const toggle = (command,note,key,value=true) => [command,note,assign({[key]:value})];
export const all = (...keys) => state => keys.every(key=>state[key]);
export const read = (command,note,result) => [command,note,null,typeof result==='function'?result:()=>result];
export const observe = (command,note,condition,ready,waiting) =>
  read(command,note,state=>(typeof condition==='function'?condition(state):all(...[].concat(condition))(state))?
    (typeof ready==='function'?ready(state):ready):(typeof waiting==='function'?waiting(state):waiting));

const configMode = path => scope('config',path);
function travel(device, from, to, push) {
  let active=from;
  const enter = (line, note, destination) => {
    push({device,command:line,explanation:note,mode:active,nextMode:destination,navigation:true});
    active=destination;
  };
  if (from.level===to.level && addressOf(from)===addressOf(to)) return;
  if (from.level==='tcl') enter('tclquit','Leave the Tcl interpreter.',scope('exec'));
  if (from.level==='user') enter('enable', 'Enter privileged EXEC to inspect or configure this device.',scope('exec'));
  if (to.level==='exec' && active.level==='config') {
    enter('end','Return to privileged EXEC and verify the changes.',scope('exec'));
    return;
  }
  if (to.level==='tcl' && active.level==='exec') {
    enter('tclsh','Open the simulated Tcl interpreter on this device.',scope('tcl'));
    return;
  }
  if (to.level==='user' && active.level==='exec') {
    enter('disable','Return to user EXEC.',scope('user'));
    return;
  }
  if (to.level!=='config') {
    if (active.level!==to.level) throw Error('Cannot change from '+active.level+' to '+to.level+'.');
    return;
  }
  if (active.level==='exec') enter('configure terminal','Enter global configuration mode.',configMode([]));
  if (active.level!=='config') throw Error('Configuration requires an IOS-style device.');
  let shared=0;
  while(shared<active.path.length && shared<to.path.length && active.path[shared]===to.path[shared]) shared++;
  while (active.path.length>shared) {
    const context=active.path.at(-1);
    enter(modeFor(context)?.[2]??'exit','Return to the parent configuration context.',configMode(active.path.slice(0,-1)));
  }
  for (const context of to.path.slice(shared)) {
    if (!modeFor(context)) throw Error('Unknown configuration context: '+context);
    enter(context,'Select '+context+' for the following configuration.',configMode([...active.path,context]));
  }
}

export function lesson(meta, groups) {
  const steps=[];
  const first={};
  const current={};
  const push = entry => {steps.push({...entry,index:steps.length});};
  for (const {device,entries,mode} of groups) {
    first[device]??=scope(['host','rommon'].includes(mode.level)?mode.level:'user');
    current[device]??=first[device];
    travel(device,current[device],mode,push);
    current[device]=mode;
    for (const [command,explanation,apply,output,configKey] of entries) {
      push({device,command,explanation,mode,apply,output,configKey});
    }
  }
  return {...meta,initialModes:first,devices:Object.keys(first),steps};
}
