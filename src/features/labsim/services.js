import { deviceById, gateway, hostIp, hostPrefix, ipv4, linkUp, macAddress, networkAddress, inSubnet, prefixLength, primaryPort, requestDhcp, transaction } from './network.js';
import { serverV6 } from './ipv6-services.js';
import { parsePrefixV6, parseV6, formatV6, routesV6, neighborRowsV6, transactionV6 } from './ipv6.js';
import { integer, invalid, keyName, own, reply } from './cli-utils.js';
import { clockDisplay } from './device-files.js';
import { cmeTftpFile } from './cme.js';

const protocols=['dhcp','dhcpv6','dns','http','https','ntp','syslog','tftp','sip','netflow'];
const servicePorts={dns:53,dhcp:67,http:80,https:443,ntp:123,syslog:514,tftp:69,sip:5060,netflow:2055};
const label=value=>/^[a-z0-9](?:[a-z0-9.-]{0,125}[a-z0-9])?$/i.test(value??'');
const ip=value=>ipv4(value)!==null;
const severity=['emergencies','alerts','critical','errors','warnings','notifications','informational','debugging'];
const level=value=>integer(value,0,7)?Number(value):severity.indexOf(value?.toLowerCase());

export const endpointCommands = [
  'ipconfig [/all]','ipconfig /renew','ipconfig /release','ip address <address> <prefix> [<gateway>]',
  'ip address dhcp','no ip address','ip default-gateway <address>','ip addr','ip addr show','ifconfig en0','ip route','route print','arp -a',
  'ipv6 address <prefix> [<gateway>]','ip -6 addr','ip -6 route','ip -6 neigh',
  'ping <address>','ping -c <count> <address>','ping -q <tos> [-c <count>] <address>','ping -c <count> -q <tos> <address>','tracert <address>','traceroute <address>','traceroute -n <address>',
  'nslookup <name> [<server>]','curl <options-and-url...>',
  'tftp get <server> <file>','tftp put <server> <file> <text...>',
  'show interfaces','show ipv6 interface brief','show dhcp lease',
  'snmpget -v2c -c <community> <address> <oid>'
];

export const serverCommands = [
  ...protocols.flatMap(name=>['service '+name+' on','service '+name+' off']),
  'dhcp scope <name> <network/prefix> <gateway> [<dns>]',
  'dhcp option 150 <scope> <address>','dhcp exclude <first> [<last>]','no dhcp scope <name>',
  'dns record <name> a <address>','dns record <name> aaaa <address>','no dns record <name>',
  'http page <path> <body...>','ntp stratum <rank>',
  'tftp file <name> <text...>','sip user <extension> <password>','no sip user <extension>',
  'netflow port <port>','show services','show dhcp bindings','show dhcp scopes','show dns records','show tftp files','show logging','show sip registrations','show netflow'
];
export const serviceIOS = {
  operational:['show ntp status','show ntp associations [detail]','show logging','show snmp','show clock detail'],
  exec:['send log <level> <message...>','terminal monitor','terminal no monitor','copy running-config <destination>'],
  global:['ntp server <address> [prefer]','no ntp server <address>','ntp master [<stratum>]','no ntp master',
    'ntp source <interface...>','logging host <address>','no logging host <address>','logging trap <level>',
    'logging buffered <size> [<level>]','ip name-server <address>','snmp-server community <name> ro','no snmp-server community <name>']
};

const store=(d,field)=>d[field]??={};
export const serviceOn=(d,service)=>Boolean(own(d.services,service));

export function servicePath(lab,client,serverIp,service, sourceAddress) {
  const v6=parseV6(serverIp)!==null;
  if(!ip(serverIp)&&!v6)return {ok:false,reason:'Set a valid '+service+' server address.',path:[client.id]};
  const web=['http','https'].includes(service);
  const packet={protocol:web?'tcp':'udp',sourcePort:49152,destinationPort:servicePorts[service]};
  const result=v6?transactionV6(lab,client,serverIp,{sourceAddress,packet,learn:web||service==='dns'}):
    transaction(lab,client,serverIp,{sourceAddress,packet,observe:web||service==='dns'});
  if (!result.ok)return result;
  const builtIn=(service==='ntp'&&result.destination.time?.master)||(service==='tftp'&&result.destination.cme?.files);
  if (!serviceOn(result.destination,service) && !builtIn) {
    return {...result,ok:false,reason:result.destination.name+' is reachable, but '+service.toUpperCase()+' is off.'};
  }
  return result;
}

export function dnsLookup(lab,d,hostname,server) {
  const address=server??d.host.lease?.dns??d.host.lease6?.dns??d.host.dns??d.nameServer;
  const path=servicePath(lab,d,address,'dns');
  if(!path.ok)return path;
  const record=own(path.destination.dnsRecords,hostname.toLowerCase());
  return record?{...path,address:record.address}: {...path,ok:false,reason:'NXDOMAIN: '+hostname};
}

export function hostIpFor(lab,host,address) {
  if(ip(address)||parseV6(address)!==null)return {ok:true,address};
  return dnsLookup(lab,host,address);
}

export function hostNetwork(lab,d,args,connectivity) {
  const [verb, sub, value, maskOrGw, def]=args;
  const c=args.join(' ').toLowerCase();
  const port=primaryPort(d);
  const iface=d.ports[port];
  if(c==='ip address dhcp'||c==='ipconfig /renew') {
    if(c==='ip address dhcp'){
      delete d.host.ip;delete d.host.prefix;delete d.host.gateway;
    }
    const result=requestDhcp(lab,d);
    return reply(result.ok?'DHCP lease: '+result.ip+' from '+result.server:result.reason,result.path);
  }
  if(c==='no ip address'||c==='ipconfig /release') {
    if(c==='no ip address'){delete d.host.ip;delete d.host.prefix;delete d.host.gateway;}
    delete d.host.lease;return reply(c==='no ip address'?'IPv4 address cleared.':'DHCP lease released.');
  }
  if(c.startsWith('ip address ')) {
    const length=prefixLength(maskOrGw?.replace(/^\//,''));
    if(!ip(value)||length===null||(def&&!ip(def)))return invalid('Use ip address IP MASK [GATEWAY].');
    Object.assign(d.host,{ip:value,prefix:length,gateway:def});delete d.host.lease;
    return reply('Static IPv4 settings applied.');
  }
  if(c.startsWith('ip default-gateway ')){
    if(!ip(value))return invalid('Enter a valid IPv4 gateway.');
    d.host.gateway=value;return reply();
  }
  if(c.startsWith('ipv6 address ')){
    const prefix=parsePrefixV6(value);const next=maskOrGw?parseV6(maskOrGw):null;
    if(!prefix||maskOrGw&&next===null)return invalid('Use ipv6 address ADDRESS/PREFIX [GATEWAY].');
    iface.ipv6=[prefix];
    d.ipv6Routes=next===null?[]:[{destination:'::',prefix:0,port,next:formatV6(next),distance:1}];
    return reply('Static IPv6 settings applied.');
  }
  const address=hostIp(d);
  const dns=d.host.lease?.dns??d.host.dns;
  if(c==='ipconfig'||c==='ipconfig /all'||c==='ip addr'||c==='ip addr show'||c==='ifconfig en0'||c==='show interfaces'){
    return reply([
      (d.host.wifi?'Wi-Fi':port)+' · '+macAddress(d),
      'IPv4 Address: '+(address?address+'/'+hostPrefix(d):'unassigned'),
      'Default Gateway: '+(gateway(d)??'—'),'DNS: '+(dns??'—'),
      ...(d.host.lease?['DHCP server: '+(deviceById(lab,d.host.lease.server)?.name??'unavailable')]:[]),
      ...(d.host.lease?.tftp?['Option 150 (TFTP): '+d.host.lease.tftp]:[]),
      ...(iface.ipv6??[]).map(row=>'IPv6 Address: '+row.address+'/'+row.prefix+(row.origin?' · '+row.origin.toUpperCase():'')),
      ...(d.host.lease6?.dns?['IPv6 DNS: '+d.host.lease6.dns]:[])
    ].join('\n'));
  }
  if(c==='show dhcp lease')return reply(d.host.lease?address+'/'+hostPrefix(d)+' via '+gateway(d):'No DHCP lease.');
  if(c==='ip route'||c==='route print')return reply(address?'Connected: '+address+'/'+hostPrefix(d)+' via '+port+(gateway(d)?'\nDefault: '+gateway(d):''):'No IPv4 routes.');
  if(c==='ip -6 route')return reply(routesV6(lab,d).map(row=>row.destination+'/'+row.prefix+(row.next?' via '+row.next:' on '+row.port)).join('\n')||'No IPv6 routes.');
  if(c==='ip -6 neigh')return reply(neighborRowsV6(lab,d).join('\n')||'No IPv6 neighbors.');
  if(c==='ip -6 addr'||c==='show ipv6 interface brief')return reply(port+'  '+(iface.ipv6?.map(row=>row.address+'/'+row.prefix).join(', ')||'unassigned'));
  if(c==='arp -a')return reply(Object.entries(d.arp??{}).filter(([,e])=>deviceById(lab,e.device)).map(([id,e])=>id+'  '+e.mac+'  dynamic').join('\n')||'No ARP entries. Try ping first.');
  if(verb==='nslookup'){
    const result=dnsLookup(lab,d,sub,value);
    return reply(result.ok?'Server: '+result.destination.name+'\nName: '+sub+'\nAddress: '+result.address:result.reason,result.path);
  }
  if(['ping','traceroute','tracert'].includes(verb)){
    const option=flag=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
    const count=option('-c')??'5',tos=option('-q')??'0';
    if(!integer(count,1,20)||!integer(tos,0,255))return invalid('Use a count from 1 to 20 and TOS from 0 to 255.');
    const destination=hostIpFor(lab,d,args.at(-1));
    return destination.ok?connectivity(lab,d,verb,destination.address,{dscp:Number(tos)>>2},Number(count)):reply(destination.reason,destination.path);
  }
  if(verb==='curl'){
    const flags=args.slice(1,-1).join(' ');
    return ['', '-i','-I','-i -X GET','-X GET'].includes(flags)?httpRequest(lab,d,args.at(-1),sub==='-I'):invalid('Use curl [-i|-I] http://HOST/PATH.');
  }
  if(verb==='tftp')return transfer(lab,d,args);
  if(verb==='snmpget')return snmpGet(lab,d,args);
  return null;
}

function httpRequest(lab,d,raw,head=false) {
  let target;
  try {target=new URL(raw);} catch {return invalid('Use a simulated HTTP or HTTPS URL.');}
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password)return invalid('Use an HTTP or HTTPS lab endpoint.');
  if(target.port)return invalid('Use the lab service’s default HTTP or HTTPS port.');
  const resolved=hostIpFor(lab,d,target.hostname.replace(/^\[|\]$/g,''));
  if(!resolved.ok)return reply(resolved.reason,resolved.path);
  const hit=servicePath(lab,d,resolved.address,target.protocol.slice(0,-1));
  if(!hit.ok)return reply(hit.reason,hit.path);
  const page=own(hit.destination.webPages,target.pathname);
  const body=page??(target.pathname==='/'?'Netra lab server':null);
  return reply(body===null?'HTTP/1.1 404 Not Found':'HTTP/1.1 200 OK\nContent-Type: text/plain\n'+(head?'':'\n'+body),hit.path);
}

function transfer(lab,d,[,action,address,name,...body]) {
  if(!keyName(name))return invalid('Use a simple lab filename.');
  const hit=servicePath(lab,d,address,'tftp');
  if(!hit.ok)return reply(hit.reason,hit.path);
  const profile=cmeTftpFile(hit.destination,name);
  if(action==='put'){
    if(!serviceOn(hit.destination,'tftp')||profile)return reply('TFTP access violation: this configuration file service is read-only.',hit.path);
    const files=store(hit.destination,'files');
    files[name]=body.join(' ').slice(0,2048);
    if(hit.destination.configBackups)delete hit.destination.configBackups[name];
    return reply('File written to '+hit.destination.name+'.',hit.path);
  }
  return reply(profile??own(hit.destination.files,name)??'Error: file not found.',hit.path);
}

export function appendLog(d,event) {
  d.log=[...(d.log??[]).slice(-59),{...event}];
}
export function emitLog(lab,d,priority,message) {
  const event={device:d.name,priority,message};
  if(priority<=(d.logging?.bufferLevel??6))appendLog(d,event);
  for(const target of d.logging?.targets??[]) {
    if(priority>(d.logging?.threshold??6))continue;
    const hit=servicePath(lab,d,target,'syslog');
    if(hit.ok)appendLog(hit.destination,event);
  }
}
const logOutput=device=>(device.log??[]).map(row=>row.device+' <'+row.priority+'> '+row.message).join('\n')||'No messages in the local log.';

function timePeers(lab,d) {
  return Object.entries(d.time?.peers??{}).map(([address,entry])=>{
    const hit=servicePath(lab,d,address,'ntp',d.ports[d.time.source]?.address);
    return {address,prefer:entry.prefer,ok:hit.ok,stratum:hit.ok?(hit.destination.time?.master??hit.destination.stratum??2):16};
  }).sort((a,b)=>Number(b.ok)-Number(a.ok)||Number(b.prefer)-Number(a.prefer)||a.stratum-b.stratum);
}

function snmpGet(lab,d,args) {
  const community=args[3],address=args[4],oid=args[5];
  const hit=transaction(lab,d,address,{packet:{protocol:'udp',sourcePort:49152,destinationPort:161}});
  if(!hit.ok)return reply(hit.reason,hit.path);
  const target=hit.destination;
  if (!target.snmp?.communities?.includes(community))return reply('SNMP request timed out or the community was rejected.',hit.path);
  target.snmp.requests=(target.snmp.requests??0)+1;
  const object=own({'sysName.0':target.name,'1.3.6.1.2.1.1.5.0':target.name,'sysDescr.0':'Netra LabSim '+target.type,'ifNumber.0':Object.keys(target.ports).length},oid);
  return reply(object===undefined?'No Such Object':oid+' = '+object,hit.path);
}

export function iosServices(lab,d,s,args,c) {
  const no=args[0]==='no';
  const words=no?args.slice(1):args;
  const [verb,topic,value,argument]=words;
  if (c==='show logging') return reply(logOutput(d));
  if (c==='show snmp') return reply('Read-only communities: '+(d.snmp?.communities?.length??0)+'\nRequest PDUs: '+(d.snmp?.requests??0));
  if (c==='show clock detail'||c.startsWith('show ntp ')) {
    const peers=timePeers(lab,d);
    const best=peers.find(peer=>peer.ok&&peer.stratum<15);
    const status=best?'Clock is synchronized, stratum '+(best.stratum+1)+', reference is '+best.address:
      d.time?.master?'Clock is synchronized to local master, stratum '+d.time.master:'Clock is unsynchronized, stratum 16';
    if(topic==='clock')return reply(clockDisplay(d)+'\n'+status);
    if(value==='status')return reply(status);
    return reply(['  address          st  reach',
      ...peers.map(peer=>(peer===best?'* ':'  ')+peer.address.padEnd(16)+String(peer.stratum).padEnd(4)+(peer.ok?'377':'0'))].join('\n'));
  }
  if(c.startsWith('send log ')) {
    const n=level(value);
    if(n<0)return invalid('Enter a logging severity 0–7.');
    emitLog(lab,d,n,words.slice(3).join(' '));return reply('Log message generated.');
  }
  if(c==='terminal monitor'||c==='terminal no monitor'){
    s.monitor=c==='terminal monitor';return reply();
  }
  if(s.mode!=='global')return null;
  if(verb==='ntp'){
    const time=store(d,'time');
    if(topic==='server'&&ip(value)){
      time.peers??={};
      if(no)delete time.peers[value];else time.peers[value]={prefer:argument==='prefer'};
      return reply();
    }
    if(topic==='master'&&(no||value===undefined||integer(value,1,15))){
      if(no)delete time.master;else time.master=Number(value??8);
      return reply();
    }
    if(topic==='source'){
      const lookup=words.slice(2).join('').toLowerCase().replace(/^gigabitethernet/,'gi').replace(/^loopback/,'lo');
      const source=Object.keys(d.ports).find(name=>name.toLowerCase()===lookup);
      if(source){time.source=source;return reply();}
    }
    return invalid('Check the NTP address, stratum or interface.');
  }
  if(verb==='logging'){
    const logging=store(d,'logging');
    if(topic==='host'&&ip(value)){
      const targets=(logging.targets??[]).filter(address=>address!==value);
      logging.targets=no?targets:[...targets,value];return reply();
    }
    if(topic==='trap'&&level(value)>=0){logging.threshold=level(value);return reply();}
    if(topic==='buffered'&&integer(value,4096,1000000)&&(!argument||level(argument)>=0)){
      logging.bufferLevel=argument?level(argument):7;return reply();
    }
    return invalid('Check the logging address and severity.');
  }
  if(c.startsWith('ip name-server ')){
    if(!ip(value))return invalid('Enter an IPv4 DNS server address.');
    d.nameServer=value;return reply();
  }
  if(verb==='snmp-server'&&topic==='community'){
    if(!keyName(value))return invalid('Enter a lab community string.');
    const snmp=store(d,'snmp');
    const other=(snmp.communities??[]).filter(x=>x!==value);
    snmp.communities=no?other:[...other,value];return reply();
  }
  return null;
}

export function serviceRunning(d) {
  return [
    ...(d.nameServer?['ip name-server '+d.nameServer]:[]),
    ...Object.entries(d.time?.peers??{}).map(([address,ntp])=>'ntp server '+address+(ntp.prefer?' prefer':'')),
    ...(d.time?.master?['ntp master '+d.time.master]:[]),
    ...(d.time?.source?['ntp source '+d.time.source]:[]),
    ...(d.logging?.targets??[]).map(address=>'logging host '+address),
    ...(d.logging?.threshold!==undefined?['logging trap '+severity[d.logging.threshold]]:[]),
    ...(d.snmp?.communities??[]).map(comm=>'snmp-server community '+comm+' ro')
  ];
}

export function serverCLI(lab,d,args) {
  const [cmd,topic,name,value,other]=args;
  const c=args.join(' ').toLowerCase();
  if(cmd==='netflow'&&topic==='port'){
    if(!integer(name,1,65535))return invalid('Use a collector port from 1 to 65535.');
    d.netflowPort=Number(name);return reply();
  }
  if(cmd==='service'){store(d,'services')[topic]=name==='on';return reply(topic.toUpperCase()+' '+name+'.');}
  const ipv6=serverV6(lab,d,args,c);
  if(ipv6)return ipv6;
  if(c==='show services')return reply(protocols.map(protocol=>protocol.toUpperCase().padEnd(8)+(serviceOn(d,protocol)?'running':'off')).join('\n'));
  if(c==='show logging')return reply(logOutput(d));
  if(c==='show dhcp scopes')return reply(Object.entries(d.pools).map(([k,p])=>k+'  '+p.network+'/'+p.prefix+'  gateway '+p.gateway).join('\n')||'No DHCP scopes.');
  if(c==='show dhcp bindings')return reply(lab.devices.filter(host=>host.host.lease?.server===d.id).map(host=>host.name+'  '+hostIp(host)+'  '+macAddress(host)).join('\n')||'No DHCP bindings.');
  if(c==='show dns records')return reply(Object.entries(d.dnsRecords??{}).map(([key,row])=>key+'  '+row.type.toUpperCase()+'  '+row.address).join('\n')||'No DNS records.');
  if(c==='show tftp files')return reply(Object.keys(d.files??{}).join('\n')||'No files.');
  if(c==='show netflow')return reply((d.flows??[]).map(flow=>[flow.source,flow.destination,flow.protocol,flow.packets+' packets',flow.exporter,flow.format].join('  ')).join('\n')||'No exported flow records.');
  if(c==='show sip registrations')return reply(Object.entries(d.registrations??{}).flatMap(([number,id])=>{
    const phone=deviceById(lab,id);
    return phone?.host.sip?.server===d.id?[number+'  '+phone.name+'  '+hostIp(phone)]:[];
  }).join('\n')||'No registered extensions.');
  if(cmd==='dhcp'&&topic==='scope'){
    const [network,raw]=value.split('/');
    const prefix=prefixLength(raw);
    if(!keyName(name)||!ip(network)||prefix===null||prefix>30||networkAddress(network,prefix)!==network||!inSubnet(other,network,prefix)||args[5]&&!ip(args[5]))return invalid('Use dhcp scope NAME NETWORK/PREFIX GATEWAY [DNS].');
    d.pools[name.toUpperCase()]={network,prefix,gateway:other,dns:args[5]};
    return reply('Scope saved.');
  }
  if(c.startsWith('no dhcp scope ')){delete d.pools[args[3].toUpperCase()];return reply();}
  if(c.startsWith('dhcp option 150 ')){
    const pool=own(d.pools,value.toUpperCase());
    if(!pool||!ip(other))return invalid('Specify an existing scope and a TFTP IPv4 address.');
    pool.tftp=other;return reply();
  }
  if(cmd==='dhcp'&&topic==='exclude'){
    const last=value??name;
    if(!ip(name)||!ip(last)||ipv4(name)>ipv4(last))return invalid('Use a valid excluded address range.');
    d.excluded.push([name,last]);return reply();
  }
  if(cmd==='dns'&&topic==='record'){
    if(!label(name)||(value==='a'?!ip(other):parseV6(other)===null))return invalid('Enter a hostname and a matching address.');
    store(d,'dnsRecords')[name.toLowerCase()]={type:value,address:other};return reply('Record saved.');
  }
  if(c.startsWith('no dns record ')){if(d.dnsRecords)delete d.dnsRecords[args[3].toLowerCase()];return reply();}
  if(cmd==='http'&&topic==='page'){
    if(!name.startsWith('/')||name.length>100)return invalid('Use a path such as /status.');
    store(d,'webPages')[name]=args.slice(3).join(' ').slice(0,2048);return reply();
  }
  if(cmd==='ntp'&&topic==='stratum'){
    if(!integer(name,1,15))return invalid('Use a stratum from 1 to 15.');
    d.stratum=Number(name);return reply();
  }
  if(cmd==='tftp'&&topic==='file'){
    if(!keyName(name))return invalid('Enter a simple file name.');
    store(d,'files')[name]=args.slice(3).join(' ').slice(0,2048);
    if(d.configBackups)delete d.configBackups[name];
    return reply();
  }
  if(cmd==='sip'&&topic==='user'){
    if(!/^\d{2,8}$/.test(name)||!value)return invalid('Enter an extension and a lab password.');
    store(d,'sipAccounts')[name]=value;return reply();
  }
  if(c.startsWith('no sip user ')){
    if(d.sipAccounts)delete d.sipAccounts[args[3]];
    if(d.registrations)delete d.registrations[args[3]];
    return reply();
  }
  return null;
}

export const phoneCommands=['sip register <server> <extension> <password>','sip unregister','show sip status','hangup'];
export function phoneService(lab,d,args) {
  const [verb,what,server,extension,password]=args;
  if(verb==='show'&&what==='sip'){
    const hit=d.host.sip?deviceById(lab,d.host.sip.server):null;
    if(hit?.registrations?.[d.host.extension]!==d.id)return reply('SIP is not registered.');
    const status=servicePath(lab,d,hostIp(hit),'sip');
    return reply(status.ok?'Registered to '+hit.name+' as '+d.host.extension:'SIP registration unreachable · '+status.reason,status.path);
  }
  if(verb==='sip'&&what==='unregister'){
    const remote=d.host.sip&&deviceById(lab,d.host.sip.server);
    if(remote?.registrations?.[d.host.extension]===d.id)delete remote.registrations[d.host.extension];
    delete d.host.sip;return reply('Registration released.');
  }
  if(verb==='sip'&&what==='register'){
    const dest=servicePath(lab,d,server,'sip');
    if(!dest.ok)return reply(dest.reason,dest.path);
    if(own(dest.destination.sipAccounts,extension)!==password)return reply('403 Forbidden · Check the lab extension and password.',dest.path);
    const previous=d.host.sip&&deviceById(lab,d.host.sip.server);
    if(previous?.registrations?.[d.host.extension]===d.id)delete previous.registrations[d.host.extension];
    d.host.extension=extension;d.host.sip={server:dest.destination.id};
    store(dest.destination,'registrations')[extension]=d.id;
    return reply('200 OK · extension '+extension+' registered with '+dest.destination.name,dest.path);
  }
  if(verb==='hangup'){
    const other=d.host.call&&deviceById(lab,d.host.call);
    if(other?.host.call===d.id)delete other.host.call;
    delete d.host.call;return reply('Call ended.');
  }
  if(verb!=='dial'||!d.host.sip)return null;
  const remote=deviceById(lab,d.host.sip.server);
  const dest=remote&&deviceById(lab,remote.registrations?.[what]);
  if(!remote||!dest||remote.registrations?.[d.host.extension]!==d.id||dest===d)return reply('404 · No reachable registered extension.');
  const signaling=servicePath(lab,d,hostIp(remote),'sip');
  const recipient=signaling.ok&&servicePath(lab,dest,hostIp(remote),'sip');
  const media=recipient?.ok&&transaction(lab,d,hostIp(dest),{packet:{protocol:'udp',sourcePort:16384,destinationPort:16384}});
  if(!media?.ok)return reply('Call failed · Check signaling, voice VLAN and media routing.',signaling.path);
  if(d.host.call||dest.host.call)return reply('486 Busy Here.',signaling.path);
  d.host.call=dest.id;dest.host.call=d.id;
  return reply('200 OK · call connected to '+what,media.path);
}
