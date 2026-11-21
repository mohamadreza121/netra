import { linkUp, macAddress, primaryPort, segment } from './network.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';
import { formatV6, interfacesV6, networkV6, parsePrefixV6, parseV6, traceV6, uplinkV6 } from './ipv6.js';
import { interfaceName } from './ios.js';

export const ipv6ServiceIOS={
  operational:['show ipv6 dhcp pool [<name>]','show ipv6 dhcp binding','show ipv6 dhcp interface [<interface...>]'],
  global:['ipv6 dhcp pool <name>','no ipv6 dhcp pool <name>'],
  interface:['ipv6 dhcp server <name>','no ipv6 dhcp server [<name>]','ipv6 dhcp relay destination <address> [<interface...>]',
    'no ipv6 dhcp relay destination <address> [<interface...>]','ipv6 address autoconfig [default]','ipv6 address dhcp','ipv6 address <prefix> eui-64',
    'ipv6 nd managed-config-flag','no ipv6 nd managed-config-flag','ipv6 nd other-config-flag','no ipv6 nd other-config-flag',
    'ipv6 nd ra suppress [all]','no ipv6 nd ra suppress [all]','ipv6 nd prefix <prefix> [no-autoconfig]','no ipv6 nd prefix <prefix>'],
  pool6:['address prefix <prefix>','dns-server <address>','domain-name <domain>']
};
export const raGuardIOS={
  operational:['show ipv6 nd raguard policy'],
  global:['ipv6 nd raguard policy <name>','no ipv6 nd raguard policy <name>'],
  interface:['ipv6 nd raguard attach-policy <name>','no ipv6 nd raguard attach-policy [<name>]'],
  raGuard:['device-role host','device-role router']
};
export const server6Commands=['dhcp6 scope <name> <prefix> [<dns>]','no dhcp6 scope <name>','show dhcp6 scopes','show dhcp6 bindings'];
export const client6Commands=['ipconfig /renew6','ipconfig /release6','ipv6 autoconfig'];

function sameNetwork(addr,address,len) {
  return parseV6(addr)!==null&&parseV6(address)!==null&&networkV6(addr,len)===networkV6(address,len);
}

function validPrefix(raw,min=0,max=128) {
  const prefix=parsePrefixV6(raw);
  return prefix&&prefix.prefix>=min&&prefix.prefix<=max&&networkV6(prefix.address,prefix.prefix)===prefix.address?prefix:null;
}

const eui64=d=>{
  const mac=BigInt('0x'+macAddress(d).replaceAll('.',''));
  return (((mac>>24n)^0x20000n)<<40n)|(0xfffen<<24n)|(mac&0xffffffn);
};
const hostPort=(d,port)=>port==='WiFi'?d.ports[primaryPort(d)]:d.ports[port];
const addEui=(d,p)=>formatV6(parseV6(p.address)|eui64(d));

export function raGuardRejects(d,entry) {
  return own(d.raGuardPolicies,d.ports[entry]?.raGuard)?.role==='host';
}

function advertised(lab,d,port) {
  const seen=segment(lab,d,port,false);
  return seen.flatMap(({device,port:from,path})=>{
    const p=device.ports[from],cfg=p?.ipv6Service;
    if(!device.ipv6Routing||!p?.up||p.vrf||cfg?.suppress)return [];
    const all=interfacesV6(device,from);
    const gateway=all.find(addr=>addr.linkLocal)?.address;
    const connected=all.filter(a=>!a.linkLocal&&a.prefix===64).map(a=>({address:networkV6(a.address,64),prefix:64,autonomous:true}));
    const rows=cfg?.prefixes??[];
    const prefixes=[...connected.filter(a=>!rows.some(p=>p.address===a.address)),...rows];
    if(!gateway||!segment(lab,device,from,false,'ra').some(r=>r.device===d&&r.port===port))return [];
    return [{device,port:from,p,cfg,prefixes,gateway,path}];
  });
}

function defaultRoute(d,port,entry) {
  d.ipv6Routes=(d.ipv6Routes??[]).filter(r=>!r.ra||r.port!==port);
  if(entry)d.ipv6Routes.push({destination:'::',prefix:0,next:entry.gateway,port,distance:1,ra:true});
}

function leaseFrom(lab,d,scope,server,port,router) {
  if(!scope?.address)return null;
  const busy=new Set(lab.devices.flatMap(dev=>Object.keys(dev.ports).flatMap(p=>interfacesV6(dev,p).map(x=>x.address))));
  const base=parseV6(scope.address), limit=1n<<BigInt(128-scope.prefix);
  for(let suffix=16n;suffix<limit&&suffix<256n;suffix++){
    const address=formatV6(base+suffix);
    if(!busy.has(address))return {address,prefix:scope.prefix,origin:'dhcp',dns:scope.dns,domain:scope.domain,server:server.id,scope:scope.name,port,router:router?.id};
  }
  return null;
}

export function obtainV6(lab,d,port,mode,withDefault=true) {
  const p=hostPort(d,port);
  if(!p||!linkUp(lab,d,port))return reply('No active IPv6 link.');
  p.ipv6=(p.ipv6??[]).filter(a=>!a.origin); p.ipv6Enabled=true;
  defaultRoute(d,port,null);
  const ads=advertised(lab,d,port);
  const router=ads[0];
  if(mode==='slaac'){
    const entry=ads.find(row=>row.prefixes.some(a=>a.prefix===64&&a.autonomous!==false));
    if(!entry)return reply('No usable IPv6 router advertisement. Check the on-link prefix and RA Guard.');
    const prefix=entry.prefixes.find(a=>a.prefix===64&&a.autonomous!==false);
    const address=addEui(d,prefix);
    p.ipv6.push({address,prefix:64,origin:'slaac'});
    if(withDefault)defaultRoute(d,port,entry);
    return reply('SLAAC address: '+address+'/64'+(withDefault?' via '+entry.gateway:''),entry.path);
  }

  // A local server or relay selects the scope from its receiving interface.
  for(const {device,port:ingress,path} of segment(lab,d,port,false)){
    const config=device.ports[ingress]?.ipv6Service;
    let server=device, scope=own(device.dhcp6,config?.pool), through=path;
    if(config?.relay){
      const target=traceV6(lab,device,config.relay.address,undefined,false);
      if(!target.ok||config.relay.port&&target.egress!==config.relay.port||!traceV6(lab,target.device,target.from,undefined,false).ok)continue;
      server=target.device;through=[...path,...target.path.slice(1)];
      const linkAddresses=interfacesV6(device,ingress).filter(a=>!a.linkLocal);
      scope=Object.values(server.dhcp6??{}).find(row=>linkAddresses.some(a=>sameNetwork(row.address,a.address,a.prefix)));
    }else if(device.type==='server'){
      const prefixes=router?.prefixes??[];
      scope=Object.values(device.dhcp6??{}).find(row=>prefixes.some(a=>sameNetwork(row.address,a.address,a.prefix)));
    }
    if(server.type==='server'&&!server.services?.dhcpv6||!scope)continue;
    const lease=leaseFrom(lab,d,scope,server,port,router?.device);
    if(!lease)continue;
    p.ipv6.push(lease);d.host.lease6=lease;
    if(router)defaultRoute(d,port,router);
    return reply('DHCPv6 address: '+lease.address+'/'+lease.prefix+' from '+server.name,through);
  }
  delete d.host.lease6;
  return reply('No DHCPv6 reply. Check the server, client link and relay.');
}

export function clientV6(lab,d,args,c) {
  const port=uplinkV6(d);
  if(c==='ipv6 autoconfig')return obtainV6(lab,d,port,'slaac');
  if(c==='ipconfig /renew6')return obtainV6(lab,d,port,'dhcp');
  if(c==='ipconfig /release6'){
    const p=hostPort(d,port);
    p.ipv6=(p.ipv6??[]).filter(x=>!x.origin);delete d.host.lease6;
    defaultRoute(d,port,null);return reply('Dynamic IPv6 address released.');
  }
  return null;
}

function scopeLines(d) {
  return Object.entries(d.dhcp6??{}).map(([name,p])=>name+'  '+(p.address?p.address+'/'+p.prefix:'unassigned')+'  DNS '+(p.dns??'—'));
}
function bindings(lab,d) {
  return lab.devices.flatMap(client=>client.host.lease6?.server===d.id?[client.name+'  '+client.host.lease6.address+'  '+macAddress(client)]:[]);
}

export function serverV6(lab,d,args,c) {
  if(c==='show dhcp6 scopes')return reply(scopeLines(d).join('\n')||'No DHCPv6 scopes.');
  if(c==='show dhcp6 bindings')return reply(bindings(lab,d).join('\n')||'No DHCPv6 bindings.');
  const [verb,sub,name,raw,dns]=args;
  if(verb==='dhcp6'&&sub==='scope'){
    const pool=validPrefix(raw,8,120);
    if(!keyName(name)||!pool||dns&&parseV6(dns)===null)return invalid('Use a DHCPv6 name, network prefix and optional DNS address.');
    (d.dhcp6??={})[name]={name,...pool,dns};return reply();
  }
  if(c.startsWith('no dhcp6 scope ')){if(d.dhcp6)delete d.dhcp6[raw];return reply();}
  return null;
}

export function iosV6Services(lab,d,s,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(c==='show ipv6 dhcp binding')return reply(bindings(lab,d).join('\n')||'No IPv6 DHCP bindings.');
  if(c.startsWith('show ipv6 dhcp pool'))return reply(scopeLines(d).filter(line=>!w[4]||line.startsWith(w[4]+' ')).join('\n')||'No DHCPv6 pools.');
  if(c.startsWith('show ipv6 dhcp interface')){
    const port=w[4]?interfaceName(w.slice(4)):undefined;
    return reply(Object.entries(d.ports).filter(([key])=>!port||key===port).flatMap(([key,p])=>{
      const conf=p.ipv6Service;
      return conf?.relay?[key+' is in relay mode · '+conf.relay.address+(conf.relay.port?' via '+conf.relay.port:'')]:
        conf?.pool?[key+' is in server mode · '+conf.pool]:[];
    }).join('\n')||'No DHCPv6 interfaces configured.');
  }
  if(c==='show ipv6 nd raguard policy')return reply(Object.entries(d.raGuardPolicies??{}).map(([name,row])=>
    name+'  device-role '+row.role+'  '+Object.keys(d.ports).filter(key=>d.ports[key].raGuard===name).join(', ')).join('\n')||'No RA Guard policies.');
  if(s.mode==='global'&&w[0]==='ipv6'&&w[1]==='nd'&&w[2]==='raguard'){
    const name=w[4];
    if(!keyName(name))return invalid('Use a valid RA Guard policy name.');
    const policies=d.raGuardPolicies??={};
    if(no){delete policies[name];return reply();}
    policies[name]??={role:'host'};return enter(s,'raGuard',name);
  }
  if(s.mode==='raGuard'&&w[0]==='device-role'){
    const policy=own(d.raGuardPolicies,s.current);
    if(!policy)return invalid('The RA Guard policy no longer exists.');
    policy.role=w[1];return reply();
  }
  if(s.mode==='global'&&w[0]==='ipv6'&&w[1]==='dhcp'&&w[2]==='pool'){
    if(!keyName(w[3]))return invalid('Choose a valid DHCPv6 pool name.');
    d.dhcp6??={};
    if(no){delete d.dhcp6[w[3]];return reply();}
    d.dhcp6[w[3]]??={name:w[3]};return enter(s,'pool6',w[3]);
  }
  if(s.mode!=='pool6')return null;
  const pool=own(d.dhcp6,s.current);
  if(!pool)return invalid('This DHCPv6 pool no longer exists.');
  if(w[0]==='address'){
    const prefix=validPrefix(w[2],8,120);
    if(!prefix)return invalid('Enter a network prefix no longer than /120.');
    Object.assign(pool,prefix);return reply();
  }
  if(w[0]==='dns-server'&&parseV6(w[1])!==null){pool.dns=formatV6(parseV6(w[1]));return reply();}
  if(w[0]==='domain-name'&&/^[\w.-]+$/.test(w[1])){pool.domain=w[1];return reply();}
  return invalid('Check the DHCPv6 pool parameters.');
}

export function ipv6ServicePort(lab,d,name,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(w[0]!=='ipv6')return null;
  const p=d.ports[name];
  if(w[1]==='nd'&&w[2]==='raguard'){
    if(d.type!=='switch')return invalid('RA Guard uses a switchport.');
    if(no)delete p.raGuard;
    else if(own(d.raGuardPolicies,w[4]))p.raGuard=w[4];
    else return invalid('Create the named RA Guard policy first.');
    return reply();
  }
  if(w[1]==='address'){
    if(w[2]==='autoconfig'||w[2]==='dhcp')return obtainV6(lab,d,name,w[2]==='dhcp'?'dhcp':'slaac',w[2]==='dhcp'||w[3]==='default');
    if(w[3]==='eui-64'){
      const prefix=validPrefix(w[2],64,64);
      if(!prefix)return invalid('Use an IPv6 /64 network prefix.');
      const address=addEui(d,prefix);
      p.ipv6=[...(p.ipv6??[]).filter(row=>row.address!==address),{address,prefix:64}];return reply();
    }
    return null;
  }
  if(!['nd','dhcp'].includes(w[1]))return null;
  if(d.type==='switch'&&p.mode==='access')return invalid('Use a routed interface or SVI for IPv6.');
  const config=p.ipv6Service??={};
  if(w[1]==='nd'){
    if(w[2]==='ra'){config.suppress=!no;return reply();}
    if(w[2]==='managed-config-flag'||w[2]==='other-config-flag'){config[w[2]]=!no;return reply();}
    if(w[2]==='prefix'){
      const prefix=validPrefix(w[3]);
      if(!prefix)return invalid('Use a valid IPv6 network prefix.');
      config.prefixes=(config.prefixes??[]).filter(row=>row.address!==prefix.address||row.prefix!==prefix.prefix);
      if(!no)config.prefixes.push({...prefix,autonomous:w[4]!=='no-autoconfig'});
      return reply();
    }
  }
  if(w[2]==='server'){
    if(no)delete config.pool;
    else if(own(d.dhcp6,w[3]))config.pool=w[3];
    else return invalid('Create the local DHCPv6 pool first.');
    return reply();
  }
  if(w[2]==='relay'){
    const address=parseV6(w[4]), out=w[5]?interfaceName(w.slice(5)):undefined;
    if(address===null||w[5]&&!d.ports[out])return invalid('Check the DHCPv6 destination or interface.');
    if(no)delete config.relay;else config.relay={address:formatV6(address),port:out};
    return reply();
  }
  return null;
}

export function ipv6ServicesRunning(d) {
  return [
    ...Object.entries(d.raGuardPolicies??{}).flatMap(([name,p])=>['ipv6 nd raguard policy '+name,' device-role '+p.role]),
    ...Object.entries(d.dhcp6??{}).flatMap(([name,p])=>['ipv6 dhcp pool '+name,
      ...(p.address?[' address prefix '+p.address+'/'+p.prefix]:[]),...(p.dns?[' dns-server '+p.dns]:[]),...(p.domain?[' domain-name '+p.domain]:[])])
  ];
}
export function ipv6ServiceLines(p) {
  const cfg=p.ipv6Service;
  return [
    ...(p.raGuard?[' ipv6 nd raguard attach-policy '+p.raGuard]:[]),
    ...(cfg?.pool?[' ipv6 dhcp server '+cfg.pool]:[]),
    ...(cfg?.relay?[' ipv6 dhcp relay destination '+cfg.relay.address+(cfg.relay.port?' '+cfg.relay.port:'')]:[]),
    ...(cfg?.suppress?[' ipv6 nd ra suppress all']:[]),
    ...['managed-config-flag','other-config-flag'].filter(key=>cfg?.[key]).map(key=>' ipv6 nd '+key),
    ...(cfg?.prefixes??[]).map(row=>' ipv6 nd prefix '+row.address+'/'+row.prefix+(row.autonomous?'':' no-autoconfig'))
  ];
}
