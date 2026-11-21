import { aclPermits } from './acl.js';
import { deviceById, hostIp, macAddress, models, peer, transaction, vlanExists } from './network.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';
import { interfaceName } from './ios.js';

export const iseCommands=[
  'application start ise','application stop ise','show application status ise','show application version ise',
  'service radius on','service radius off','service tacacs on','service tacacs off',
  'network-device <address> secret <shared-key>','no network-device <address>',
  'identity user <username> password <password>','no identity user <username>',
  'authorization <username> vlan <id>','authorization <username> deny',
  'show network-devices','show identities','show radius live-logs','show tacacs live-logs'
];
export const identityClientCommands=['dot1x login <username> <password>','dot1x logout','dot1x status','ssh -l <username> <address> [<password>]'];
export const identityIOS={
  operational:['show ip ssh','show aaa servers','show users','show radius statistics'],
  exec:['test aaa group <group> <username> <password> legacy','test aaa group <group> <username> <password> new-code'],
  global:[
    'aaa new-model','no aaa new-model','ip ssh version 2','ip ssh time-out <seconds>','ip ssh authentication-retries <number>',
    'ip domain name <domain>','ip domain-name <domain>','crypto key generate rsa [modulus <bits>]','crypto key zeroize rsa',
    'username <user> secret <value>','username <user> password <value>','username <user> privilege <level> secret <value>',
    'username <user> privilege <level> algorithm-type scrypt secret <value>','no username <user>',
    'radius server <name>','tacacs server <name>',
    'aaa group server radius <name>','aaa group server tacacs+ <name>',
    'aaa authentication login <list> local','aaa authentication login <list> group <group> [local]',
    'aaa authentication dot1x <list> group <group>','aaa authorization network default group <group>',
    'aaa authorization exec <list> group <group> [local]','aaa accounting exec <list> start-stop group <group>',
    'ip radius source-interface <interface...>','ip tacacs source-interface <interface...>',
    'line vty <first> [<last>]','line console 0','dot1x system-auth-control','no dot1x system-auth-control'
  ],
  radius:['address ipv4 <address> [auth-port <port>] [acct-port <port>]','key <secret>','timeout <seconds>'],
  tacacs:['address ipv4 <address> [port <port>]','key <secret>','timeout <seconds>'],
  aaagroup:['server name <server>','no server name <server>','ip radius source-interface <interface...>','ip tacacs source-interface <interface...>'],
  line:['transport input ssh','transport input telnet','transport input all','transport input none',
    'login local','login authentication <method>','no login authentication','password <secret>','login','exec-timeout <minutes> [<seconds>]',
    'authorization exec <method>','accounting exec <method>','access-class <list> in','no access-class <list> in','logging synchronous'],
  switchOperational:['show authentication sessions','show authentication sessions interface <interface...>',
    'show access-session','show access-session interface <interface...>','show dot1x interface <interface...>'],
  interface:['authentication port-control auto','authentication port-control force-authorized','authentication port-control force-unauthorized',
    'no authentication port-control','dot1x pae authenticator','no dot1x pae authenticator']
};

const ip=value=>/^\d{1,3}(\.\d{1,3}){3}$/.test(value??'')&&value.split('.').every(x=>Number(x)<=255);
const identity=d=>d.identity??={networkDevices:{},users:{},logs:[]};
const aaa=d=>d.aaa??={local:{},servers:{radius:{},tacacs:{}},groups:{},login:{},lines:{},sources:{}};
const statistics=d=>d.aaaStats??={accept:0,reject:0,timeout:0};
const normalizedProtocol=protocol=>protocol==='tacacs+'?'tacacs':protocol;

function addAuthLog(server,entry) {
  const data=identity(server);
  data.logs=[...data.logs.slice(-79),entry];
}

export function authenticate(lab,nas,type,groupName,username,password) {
  const cfg=nas.aaa;
  const group=own(cfg?.groups,groupName);
  const dynamic=groupName==='radius'||groupName==='tacacs+';
  const names=group?.servers??(dynamic?Object.keys(cfg?.servers[normalizedProtocol(groupName)]??{}):[]);
  const protocol=group?.protocol??normalizedProtocol(groupName);
  let verdict={status:'timeout',reason:'No reachable '+type+' service in group '+groupName+'.',path:[nas.id]};
  for(const name of names){
    const server=own(cfg?.servers[protocol],name);
    if(!server?.ip||(type==='dot1x'&&protocol!=='radius'))continue;
    const sourceName=group?.source??cfg.sources[protocol];
    const explicitSource=sourceName?nas.ports[sourceName]?.address:undefined;
    if(sourceName&&!explicitSource)continue;
    const expectedPort=protocol==='radius'?1812:49;
    const portIndex=(server.options??[]).indexOf(protocol==='radius'?'auth-port':'port');
    const port=portIndex<0?expectedPort:Number(server.options[portIndex+1]);
    if(port!==expectedPort)continue;
    const packet={protocol:protocol==='radius'?'udp':'tcp',sourcePort:49152,destinationPort:port};
    const hit=transaction(lab,nas,server.ip,{sourceAddress:explicitSource,packet});
    if(!hit.ok)continue;
    const target=hit.destination;
    if(target.type!=='ise'||!target.identity?.running||!target.identity?.[protocol])continue;
    const data=target.identity;
    const nad=own(data.networkDevices,hit.source);
    if (!nad||nad.secret!==server.key) {
      addAuthLog(target,{protocol,nas:hit.source,username,status:'timeout',reason:'Unknown network device or shared secret mismatch'});
      verdict={status:'timeout',reason:target.name+': check the registered device source IP and key.',path:hit.path};
      continue;
    }
    const user=own(data.users,username);
    const accepted=user?.password===password&&!user.deny;
    const status=accepted?'accept':'reject';
    const reason=accepted?'User authenticated':user?.deny?'Authorization rule denied access':'Invalid lab identity or password';
    addAuthLog(target,{protocol,nas:hit.source,username,status,reason,vlan:accepted?user.vlan:undefined});
    verdict={status,reason,path:hit.path,vlan:accepted?user.vlan:undefined,server:target.id};
    break;
  }
  statistics(nas)[verdict.status]++;
  return verdict;
}

export function iseCLI(lab,d,args) {
  const [cmd,action,name,option,value]=args;
  const c=args.join(' ').toLowerCase();
  const data=identity(d);
  if(cmd==='application'){
    data.running=action==='start';
    return reply(data.running?'ISE policy service started.':'ISE policy service stopped.');
  }
  if(c==='show application status ise')return reply('Application Server        '+(data.running?'running':'stopped')+
    '\nRADIUS Policy Service     '+(data.running&&data.radius?'running':'stopped')+'\nTACACS+ Device Admin      '+(data.running&&data.tacacs?'running':'stopped'));
  if(c==='show application version ise')return reply('Netra ISE practice model · Policy Service and Device Administration');
  if(cmd==='service'){data[action]=name==='on';return reply(action.toUpperCase()+' '+name+'.');}
  if(cmd==='network-device'&&ip(action)&&name==='secret'&&option){
    data.networkDevices[action]={secret:option};return reply('Network access device registered.');
  }
  if(c.startsWith('no network-device ')){delete data.networkDevices[name];return reply();}
  if(c.startsWith('identity user ')&&keyName(name)&&value){
    data.users[name]={...own(data.users,name),password:value};return reply('Identity saved.');
  }
  if(c.startsWith('no identity user ')){delete data.users[option];return reply();}
  if(cmd==='authorization'){
    const user=own(data.users,action);
    if(!user)return invalid('Create the lab identity first.');
    if(name==='deny'){user.deny=true;return reply('Deny result applied.');}
    if(!integer(option,1,4094))return invalid('Enter a VLAN from 1 to 4094.');
    user.vlan=Number(option);delete user.deny;return reply('VLAN authorization result saved.');
  }
  if(c==='show network-devices')return reply(Object.keys(data.networkDevices).map(address=>address+'  configured').join('\n')||'No registered network devices.');
  if(c==='show identities')return reply(Object.entries(data.users).map(([user,entry])=>user+(entry.deny?'  Deny':entry.vlan?'  VLAN '+entry.vlan:'  Permit')).join('\n')||'No lab identities.');
  if(c.endsWith(' live-logs')){
    const rows=data.logs.filter(entry=>entry.protocol===action);
    return reply(rows.reverse().map(e=>[e.status.toUpperCase(),e.nas,e.username,e.reason,e.vlan?'VLAN '+e.vlan:''].filter(Boolean).join(' · ')).join('\n')||'No authentication attempts.');
  }
  return null;
}

export function accessState(lab,sw,name) {
  const setting=sw.ports[name];
  if(!setting?.authMode||setting.authMode==='force-authorized')return {allowed:true};
  if(setting.authMode==='force-unauthorized')return {allowed:false};
  if(!sw.aaa?.dot1x)return {allowed:true};
  const far=peer(lab,sw,name);
  const active=far&&setting.authentication?.client===far.device&&setting.authentication;
  return {allowed:Boolean(active?.status==='accept'),vlan:active?.vlan};
}

export function hostDot1x(lab,host,args) {
  if(args[0]!=='dot1x')return null;
  const far=peer(lab,host,models[host.type].ports[0]);
  const sw=far&&deviceById(lab,far.device);
  const port=sw?.ports[far?.port];
  if(sw?.type!=='switch'||!port?.authMode||!sw.aaa?.dot1x||!host.ports.Eth0.up||!port.up)return reply('No active wired authenticator on the local link.');
  const action=args[1];
  if(action==='status'){
    const state=accessState(lab,sw,far.port);
    return reply((state.allowed?'Authorized':'Unauthorized')+' · '+sw.name+' '+far.port+(state.vlan?' · VLAN '+state.vlan:''));
  }
  if(action==='logout'){
    delete port.authentication;delete host.host.lease;return reply('802.1X session cleared.');
  }
  const result=authenticate(lab,sw,'dot1x',sw.aaa?.dot1xGroup??'radius',args[2],args[3]);
  const vlanValid=!result.vlan||vlanExists(sw,result.vlan);
  const accepted=result.status==='accept'&&vlanValid;
  port.authentication={client:host.id,status:accepted?'accept':'reject',username:args[2],vlan:result.vlan};
  delete host.host.lease;
  const reason=!vlanValid?'Assigned VLAN '+result.vlan+' is missing.':result.reason;
  return reply(accepted?'802.1X authorized'+(result.vlan?' on VLAN '+result.vlan:'')+'. Run ipconfig /renew.':'802.1X denied · '+reason,result.path);
}

function lineFor(device) {
  const lines=Object.entries(device.aaa?.lines??{});
  return lines.find(([key])=>key.startsWith('vty '))?.[1]??{};
}

export function sshProbe(lab,from,username,address,password) {
  const hit=transaction(lab,from,address,{packet:{protocol:'tcp',sourcePort:49152,destinationPort:22}});
  if(!hit.ok)return hit;
  const device=hit.destination;
  const cfg=device.aaa;
  const line=lineFor(device);
  if(!cfg?.sshKey||!cfg?.sshVersion||['none','telnet'].includes(line.transport)){
    return {...hit,ok:false,reason:'Connection refused: check SSH keys, version and VTY transport.'};
  }
  if(line.acl&&!aclPermits(device,line.acl,hit.source,address,'echo',true,true))return {...hit,ok:false,reason:'Connection refused by the VTY access list.'};
  if(password===undefined)return {...hit,challenge:true};
  const local=()=>own(cfg.local,username)?.secret===password;
  const method=cfg.enabled&&!['LOCAL','LINE'].includes(line.method)&&own(cfg.login,line.method??'default');
  const verdict=method?.group?authenticate(lab,device,'login',method.group,username,password):null;
  const ok=line.method==='LINE'?Boolean(line.password)&&line.password===password:
    verdict?.status==='accept'||(!verdict&&(method?.local||!method)||verdict?.status==='timeout'&&method.local)&&local();
  if(!ok)return {...hit,ok:false,reason:'Permission denied.'};
  const privilege=verdict?.status==='accept'?1:own(cfg.local,username)?.privilege??1;
  cfg.sessions=[...(cfg.sessions??[]).slice(-9),{username,from:hit.source}];
  return {...hit,privilege};
}

export function identityCLI(lab,d,s,args,c) {
  const no=args[0]==='no';
  const w=no?args.slice(1):args;
  const [verb,topic,value,option,arg,...rest]=w;
  if(c==='show ip ssh'){
    return reply(d.aaa?.sshVersion&&d.aaa?.sshKey?'SSH Enabled - version 2.0\nAuthentication timeout: '+(d.aaa.sshTimeout??120)+' secs; retries: '+(d.aaa.sshRetries??3):'SSH Disabled. Configure hostname/domain and an RSA key pair.');
  }
  if(c==='show radius statistics'){
    const stats=statistics(d);
    return reply('Access-Accept: '+stats.accept+'\nAccess-Reject: '+stats.reject+'\nTimeouts: '+stats.timeout);
  }
  if(c==='show aaa servers'){
    return reply(Object.entries(d.aaa?.servers??{}).flatMap(([protocol,entries])=>Object.entries(entries).map(([name,server])=>{
      const hit=server.ip&&transaction(lab,d,server.ip,{control:true});
      const live=hit?.ok&&hit.destination.identity?.running&&hit.destination.identity?.[protocol];
      return protocol.toUpperCase()+' '+name+' '+(server.ip??'unassigned')+' '+(live?'Reachable':'Unavailable');
    })).join('\n')||'No AAA servers configured.');
  }
  if(c==='show users')return reply((d.aaa?.sessions??[]).map((e,i)=>'vty '+i+'  '+e.username+'  '+e.from).join('\n')||'No simulated VTY sessions.');
  if(c.startsWith('test aaa group ')){
    const result=authenticate(lab,d,'login',option,arg,rest[0]);
    return reply(result.status==='accept'?'User successfully authenticated.':result.status.toUpperCase()+' · '+result.reason,result.path);
  }
  if(c.startsWith('show authentication sessions')||c.startsWith('show access-session')||c.startsWith('show dot1x interface')){
    const candidate=w.includes('interface')?interfaceName(w.slice(w.indexOf('interface')+1).filter(term=>!['details','detail'].includes(term))):null;
    return reply(Object.entries(d.ports).filter(([name,p])=>p.authMode&&(!candidate||candidate===name)).map(([name,p])=>{
      const state=accessState(lab,d,name);
      return name+'  '+(state.allowed?'Authorized':'Unauthorized')+'  '+(p.authentication?.username??'—')+(state.vlan?'  VLAN '+state.vlan:'');
    }).join('\n')||'No 802.1X sessions.');
  }
  if(s.mode==='line'){
    const line=aaa(d).lines[s.current];
    if(verb==='transport'){line.transport=value;return reply();}
    if(verb==='login'){
      if(topic==='authentication')line.method=no?undefined:value;
      else if(topic==='local')line.method='LOCAL';
      else line.method='LINE';
      return reply();
    }
    if(verb==='password'){line.password=topic;return reply();}
    if(verb==='exec-timeout'&&integer(topic,0,35791)&&(!value||integer(value,0,59))){line.timeout=topic+' '+(value??'0');return reply();}
    if(verb==='authorization'||verb==='accounting'){line[verb]=value;return reply();}
    if(verb==='access-class'){line.acl=no?undefined:topic;return reply();}
    if(verb==='logging'){line.synchronous=true;return reply();}
    return invalid('Check the VTY or console arguments.');
  }
  if(s.mode==='radius'||s.mode==='tacacs'){
    const server=aaa(d).servers[s.mode][s.current];
    if(verb==='address'&&ip(value)){
      if(w.slice(3).some((item,i)=>i%2===1&&!integer(item,1,65535)))return invalid('Check the AAA UDP or TCP port.');
      server.ip=value;server.options=w.slice(3);return reply();
    }
    if(verb==='key'){server.key=topic;return reply();}
    if(verb==='timeout'&&integer(topic,1,60)){server.timeout=Number(topic);return reply();}
    return invalid('Check the AAA server settings.');
  }
  if(s.mode==='aaagroup'){
    const group=aaa(d).groups[s.current];
    if(verb==='server'&&topic==='name'&&own(d.aaa.servers[group.protocol],value)){
      const previous=group.servers.filter(name=>name!==value);
      group.servers=no?previous:[...previous,value];return reply();
    }
    if(verb==='ip'&&value==='source-interface'){
      const name=interfaceName(w.slice(3));
      if(d.ports[name]){group.source=name;return reply();}
    }
    return invalid('Create the AAA server definition or interface first.');
  }
  if(s.mode!=='global')return null;
  if(verb==='ip'&&['radius','tacacs'].includes(topic)&&value==='source-interface'){
    const name=interfaceName(w.slice(3));
    if(!d.ports[name])return invalid('Select an existing source interface.');
    aaa(d).sources[topic]=name;return reply();
  }
  if(verb==='ip'&&(topic==='domain-name'||topic==='domain'&&value==='name')){
    const fqdn=w.at(-1);
    if(!/^[a-z0-9][a-z0-9.-]{1,125}$/i.test(fqdn))return invalid('Enter a valid lab domain.');
    aaa(d).domain=fqdn;return reply();
  }
  if(verb==='crypto'){
    const config=aaa(d);
    if(topic==='key'&&value==='zeroize'){delete config.sshKey;return reply('Lab RSA key removed.');}
    const modulus=rest[0];
    if(!config.domain||modulus&&!integer(modulus,1024,4096))return invalid('Set ip domain name and use a modulus from 1024 to 4096.');
    config.sshKey=Number(modulus??2048);return reply('Lab RSA key generated.');
  }
  if(verb==='ip'&&topic==='ssh'){
    const cfg=aaa(d);
    if(value==='version')cfg.sshVersion=2;
    else if(value==='time-out'&&integer(option,1,120))cfg.sshTimeout=Number(option);
    else if(value==='authentication-retries'&&integer(option,1,5))cfg.sshRetries=Number(option);
    else return invalid('Check the SSH parameter.');
    return reply();
  }
  if(verb==='username'&&keyName(topic)){
    const cfg=aaa(d);
    if(no){delete cfg.local[topic];return reply();}
    const privilege=value==='privilege'?option:'1';
    if(!integer(privilege,0,15)||!w.at(-1))return invalid('Check the username or privilege level.');
    cfg.local[topic]={privilege:Number(privilege),secret:w.at(-1)};return reply();
  }
  if(verb==='aaa'){
    const cfg=aaa(d);
    if(topic==='new-model'){cfg.enabled=!no;return reply();}
    if(topic==='group'&&value==='server'&&keyName(arg)){
      cfg.groups[arg]??={protocol:normalizedProtocol(option),servers:[]};
      return enter(s,'aaagroup',arg);
    }
    if(topic==='authentication'){
      if(value==='dot1x'&&keyName(option)){
        cfg.dot1xLists??={};cfg.dot1xLists[option]=rest[0];
        if(option==='default')cfg.dot1xGroup=rest[0];return reply();
      }
      if(value!=='login'||!keyName(option))return invalid('Choose a valid authentication method list name.');
      cfg.login[option]={group:arg==='group'?rest[0]:undefined,local:w.at(-1)==='local'};return reply();
    }
    if((topic==='authorization'||topic==='accounting')&&keyName(option)){
      cfg[topic]??={};cfg[topic][option]=w.slice(2).join(' ');return reply();
    }
  }
  if(['radius','tacacs'].includes(verb)&&topic==='server'&&keyName(value)){
    aaa(d).servers[verb][value]??={};
    return enter(s,verb,value);
  }
  if(verb==='line'&&integer(value,0,15)&&(!option||integer(option,Number(value),15))){
    const name=w.slice(1).join(' ');aaa(d).lines[name]??={};return enter(s,'line',name);
  }
  if(verb==='dot1x'){aaa(d).dot1x=!no;return reply();}
  return null;
}

export function portIdentity(d,port,args,c) {
  if(d.type!=='switch')return null;
  const p=d.ports[port];
  if(c.startsWith('authentication port-control ')||c==='no authentication port-control'){
    p.authMode=args[0]==='no'?undefined:args[2];delete p.authentication;return reply();
  }
  if(c==='dot1x pae authenticator'||c==='no dot1x pae authenticator'){p.dot1x=args[0]!=='no';return reply();}
  return null;
}

export const identityDebug = d => Object.entries(d.aaa?.lines??{}).flatMap(([line,config])=>{
  return ['line '+line,...(config.transport?[' transport input '+config.transport]:[]),
    ...(config.method?[' login '+(config.method==='LOCAL'?'local':config.method==='LINE'?'':'authentication '+config.method)]:[]),
    ...(config.acl?[' access-class '+config.acl+' in']:[])];
});

export function identityRunning(d) {
  const cfg=d.aaa;
  if(!cfg)return [];
  return [
    ...(cfg.domain?['ip domain name '+cfg.domain]:[]),
    ...(cfg.sshVersion?['ip ssh version '+cfg.sshVersion]:[]),
    ...(cfg.enabled?['aaa new-model']:[]),
    ...Object.entries(cfg.local).map(([name,user])=>'username '+name+' privilege '+user.privilege+' secret [configured]'),
    ...Object.entries(cfg.servers).flatMap(([protocol,servers])=>Object.entries(servers).flatMap(([name,server])=>[
      protocol+' server '+name,...(server.ip?[' address ipv4 '+server.ip]:[]),...(server.key?[' key [configured]']:[])
    ])),
    ...Object.entries(cfg.groups).flatMap(([name,group])=>['aaa group server '+(group.protocol==='tacacs'?'tacacs+':group.protocol)+' '+name,...group.servers.map(server=>' server name '+server)]),
    ...Object.entries(cfg.login).map(([name,entry])=>'aaa authentication login '+name+(entry.group?' group '+entry.group:'')+(entry.local?' local':'')),
    ...(cfg.dot1x?['dot1x system-auth-control']:[]),
    ...Object.entries(cfg.dot1xLists??{}).map(([name,group])=>'aaa authentication dot1x '+name+' group '+group),
    ...['authorization','accounting'].flatMap(type=>Object.values(cfg[type]??{}).map(line=>'aaa '+type+' '+line)),
    ...identityDebug(d)
  ];
}

export function clientIdentity(lab,host,s,args) {
  if(args[0]==='dot1x')return hostDot1x(lab,host,args);
  if(args[0]!=='ssh')return null;
  return beginSsh(lab,host,s,args[2],args[3],args[4]);
}

export function beginSsh(lab,host,s,user,address,password) {
  const hit=sshProbe(lab,host,user,address,password);
  if(!hit.ok)return reply(hit.reason,hit.path);
  if(hit.challenge){s.passwordPrompt={user,address};return reply('Password required for '+user+'@'+address,hit.path);}
  s.remote={id:hit.destination.id,session:{mode:hit.privilege===15?'exec':'user',current:null,history:[]}};
  return reply('Connected to '+hit.destination.name+' via simulated SSH. Type exit at EXEC to disconnect.',hit.path);
}

export const authMac = device => macAddress(device).toLowerCase();
