import { deviceById, gateway, hostIp, ipv4, linkUp, primaryPort, voiceVlan } from './network.js';
import { enter, integer, invalid, own, reply } from './cli-utils.js';
import {
  blankCme, bootCme, cmeDefaults, cmeRouter, cmeSourceUp, cmeTftpFiles, phoneLines, phoneMac,
  phoneSettings, registerCme, registrationStatus, tftpAddress, unregisterCme, usesCme
} from './cme.js';
import { callDetails, callTable, clearPhoneCalls, cmeCallCommand, refreshCalls, voiceLog } from './voice-calls.js';

const shows=[
  'show telephony-service [all]','show telephony-service tftp-bindings','show telephony-service events',
  'show ephone [<tag>]','show ephone registered [summary]','show ephone unregistered [summary]',
  'show ephone attempted-registrations','show ephone summary [brief]','show ephone dn <tag>',
  'show ephone ringing','show ephone offhook','show ephone rtp connections',
  'show ephone-dn [<tag>]','show call active voice [brief]','show call history voice [brief]'
];

export const cmeIOS={
  exec:[...shows,'clear telephony-service ephone-attempted-registrations'],
  global:['telephony-service','no telephony-service','ephone-dn <tag> [dual-line]','ephone-dn <tag> octo-line',
    'no ephone-dn <tag>','ephone <tag>','no ephone <tag>'],
  telephony:['max-ephones <count>','max-dn <count>','ip source-address <address> [port <port>]','no ip source-address',
    'keepalive <seconds>','no keepalive','create cnf-files','no create cnf-files','auto-reg-ephone','no auto-reg-ephone',
    'auto assign <first> to <last>','no auto assign [<first> to <last>]','restart all','reset all'],
  ephoneDn:['number <extension> [secondary <extension>]','no number','name <text...>','no name','label <text...>','no label',
    'description <text...>','no description','call-forward all <extension>','no call-forward all',
    'call-forward busy <extension>','no call-forward busy'],
  ephone:['mac-address <mac>','no mac-address','type <model>','no type','button <mappings...>','no button <mappings...>',
    'keepalive <seconds>','no keepalive','restart','reset']
};

export const cmePhoneCommands=[
  'boot','sccp register','sccp unregister','sccp tftp <address>','no sccp tftp',
  'show sccp status','show phone network','show phone log','show phone calls','answer','reject'
];

const extension=number=>/^\d{1,16}$/.test(number??'');
const activeSource=(lab,d)=>cmeSourceUp(lab,d,d.cme?.source);
const entries=(object,tag)=>Object.entries(object??{}).filter(([key])=>!tag||Number(key)===Number(tag));
const statusText=state=>state?'REGISTERED':'UNREGISTERED';
const isKeepalive=raw=>integer(raw,10,65535);

export function cmePhoneCLI(lab,phone,args,c) {
  const [verb,action]=args;
  const router=cmeRouter(lab,phone);
  const managed=usesCme(lab,phone);
  if(c==='boot'||c==='sccp register'){
    clearPhoneCalls(lab,router,phone,'Phone restarted or reregistered.');
    return c==='boot'?bootCme(lab,phone):registerCme(lab,phone);
  }
  if(c==='sccp unregister'){
    clearPhoneCalls(lab,router,phone,'Phone unregistered.');
    unregisterCme(lab,phone);
    phoneSettings(phone).reason='Phone unregistered. Run sccp register.';
    return reply('SCCP registration released.');
  }
  if(c.startsWith('sccp tftp ')||c==='no sccp tftp'){
    if(verb==='sccp'&&ipv4(args[2])===null)return invalid('Use a valid TFTP IPv4 address.');
    const settings=phoneSettings(phone);
    if(verb==='no')delete settings.tftp;
    else settings.tftp=args[2];
    return reply('TFTP settings updated. Run boot or sccp register to apply them.');
  }
  if(c==='show phone network'){
    const ethernet=primaryPort(phone);
    return reply([
      'Phone Network Configuration', 'MAC Address: '+phoneMac(phone), 'IPv4 Address: '+(hostIp(phone)??'Unassigned'),
      'Default Router: '+(gateway(phone)??'Unassigned'),
      'Operational VLAN ID: '+(voiceVlan(lab,phone)??'Untagged'),
      'TFTP Server 1: '+(tftpAddress(phone)??'Unassigned'),
      'TFTP source: '+(phone.host.cme?.tftp?'Static override':phone.host.lease?.tftp?'DHCP option 150':'None'),
      'Switch port ('+ethernet+'): '+(linkUp(lab,phone,ethernet)?'up':'down'),
      'PC port (Eth1): '+(linkUp(lab,phone,'Eth1')?'up':'down')
    ].join('\n'));
  }
  if(c==='show phone log'){
    const remembered=deviceById(lab,phone.host.cme?.lastRouter);
    const local=phone.host.cme?.localEvents??[];
    return reply([...local,voiceLog(router??remembered,phone)].join('\n'));
  }
  if(c==='show phone calls'){
    const active=callDetails(lab,router,phone);
    return reply(active.length?callTable(active):'No active SCCP calls.');
  }
  if(c==='show sccp status'||(c==='show phone'&&managed)){
    const status=registrationStatus(lab,phone,router),cfg=router?.cme;
    const lines=status.ok?phoneLines(cfg,status.record):[];
    const call=callDetails(lab,router,phone)[0];
    return reply([
      phone.name+' · SCCP · '+statusText(status.ok), 'MAC Address: '+phoneMac(phone),
      'IPv4 Address: '+(hostIp(phone)??'Unassigned'), 'Voice VLAN: '+(voiceVlan(lab,phone)??'Untagged'),
      'TFTP Server: '+(tftpAddress(phone)??'Unassigned'),
      'Call Manager: '+(cfg?.source?cfg.source+':'+cfg.port:'Unassigned'),
      ...(!status.ok?['Status reason: '+status.reason]:[]),
      ...lines.map(({button,dn,line})=>'Line '+button+': '+line.number+(line.label?' ('+line.label+')':'')+' · DN '+dn),
      ...(!lines.length?['Extension: Unassigned']:[]),
      'Call state: '+(call?call.state+' · '+(call.callee===phone.id?'Incoming from '+call.from:'Outgoing to '+call.to):'IDLE')
    ].join('\n'),status.path);
  }
  if(verb==='extension'&&managed)return invalid('Assign the number on CME with ephone-dn and auto assign or button.');
  if(verb==='answer'||verb==='reject'||(['dial','hangup'].includes(verb)&&managed))return cmeCallCommand(lab,phone,verb,action);
  return null;
}

export function cmeAfterEndpoint(lab,phone,command,result) {
  if(!result||result.text.startsWith('%'))return result;
  if(command.startsWith('sip register ')&&result.text.startsWith('200 OK')){
    const router=cmeRouter(lab,phone);
    clearPhoneCalls(lab,router,phone,'Phone switched to SIP.');
    unregisterCme(lab,phone);
    if(phone.host.cme)delete phone.host.cme.mode;
  }
  if((command==='ipconfig /renew'||command==='ip address dhcp')&&usesCme(lab,phone)){
    const registration=registerCme(lab,phone);
    return reply(result.text+'\n'+registration.text,registration.path.length>1?registration.path:result.path);
  }
  return result;
}

function restartPhones(lab,router,records,renew) {
  const phones=lab.devices.filter(phone=>phone.type==='phone'&&records.some(record=>record.mac===phoneMac(phone)));
  if(!phones.length)return reply('No matching lab phones.');
  const results=phones.map(phone=>{
    clearPhoneCalls(lab,router,phone,'CME '+(renew?'reset':'restart')+' requested.');
    return renew?bootCme(lab,phone):registerCme(lab,phone);
  });
  return reply(results.map(result=>result.text).join('\n\n'),results.at(-1).path);
}

function ephoneConfig(lab,d,record,w,no) {
  const [verb,arg]=w;
  if(verb==='mac-address'){
    if(no){delete record.mac;return reply();}
    if(!/^(?:[0-9a-f]{4}\.){2}[0-9a-f]{4}$/i.test(arg))return invalid('Use the dotted MAC address shown on the phone.');
    const mac=arg.toUpperCase();
    if(Object.values(d.cme.phones).some(row=>row!==record&&row.mac===mac))return invalid('This MAC is already assigned to another ephone.');
    record.mac=mac;return reply();
  }
  if(verb==='type'){
    if(!no&&!/^\d{4}$/.test(arg))return invalid('Use a four-digit phone model, such as 7960.');
    if(no)delete record.model;else record.model=arg;
    return reply();
  }
  if(verb==='keepalive'){
    if(!no&&!isKeepalive(arg))return invalid('Use a keepalive interval from 10 to 65535 seconds.');
    if(no)delete record.keepalive;else record.keepalive=Number(arg);
    return reply();
  }
  if(verb==='button'){
    const mappings={...record.buttons};
    for(const value of w.slice(1)){
      const match=/^([1-9]\d?):([1-9]\d{0,3})$/.exec(value);
      const button=match?.[1]??value,dn=match?.[2];
      if(!integer(button,1,34)||(!no&&!own(d.cme.dns,dn)))return invalid('Use button BUTTON:DN with a configured directory number, e.g. button 1:1.');
      if(no){if(!dn||String(mappings[button])===dn)delete mappings[button];}
      else mappings[button]=Number(dn);
    }
    record.buttons=mappings;return reply();
  }
  if(verb==='reset'||verb==='restart')return restartPhones(lab,d,[record],verb==='reset');
  return null;
}

function dnConfig(line,w,no) {
  const [verb,arg,secondary,alternate]=w;
  if(verb==='number'){
    if(!no&&(!extension(arg)||secondary&&(!extension(alternate)||arg===alternate)))
      return invalid('Use a 1–16 digit number and, optionally, a distinct secondary number.');
    if(no){delete line.number;delete line.secondary;}
    else {line.number=arg;line.secondary=alternate;}
    return reply();
  }
  if(['name','label','description'].includes(verb)){
    const value=w.slice(1).join(' ');
    if(!no&&(!value||value.length>48||/[\r\n]/.test(value)))return invalid('Use text up to 48 characters.');
    if(no)delete line[verb];else line[verb]=value;
    return reply();
  }
  if(verb==='call-forward'){
    if(!no&&!extension(secondary))return invalid('Use a local extension number.');
    const key=arg==='all'?'forwardAll':'forwardBusy';
    if(no)delete line[key];else line[key]=secondary;
    return reply();
  }
  return null;
}

function telephonyConfig(lab,d,cfg,w,no) {
  const [verb,arg,value,,extra]=w;
  if(verb==='max-ephones'||verb==='max-dn'){
    const isPhone=verb==='max-ephones',limit=isPhone?250:1000;
    if(!integer(arg,1,limit))return invalid('This lab platform supports '+verb+' from 1 to '+limit+'.');
    const highest=Math.max(0,...Object.keys(isPhone?cfg.phones:cfg.dns).map(Number),isPhone?0:cfg.assign?.last??0);
    if(Number(arg)<highest)return invalid('Remove higher tags or auto-assign ranges before lowering the limit.');
    cfg[isPhone?'maxPhones':'maxDns']=Number(arg);return reply();
  }
  if(verb==='ip'){
    if(!no&&(ipv4(value)===null||value==='0.0.0.0'||!integer(extra??'2000',1,65535)))return invalid('Use ip source-address ADDRESS [port PORT].');
    if(no){delete cfg.source;delete cfg.port;}
    else {cfg.source=value;cfg.port=Number(extra??cmeDefaults.port);}
    return reply();
  }
  if(verb==='keepalive'){
    if(!no&&!isKeepalive(arg))return invalid('Use a keepalive interval from 10 to 65535 seconds.');
    if(no)delete cfg.keepalive;else cfg.keepalive=Number(arg);
    return reply();
  }
  if(verb==='auto-reg-ephone'){cfg.autoRegister=!no;return reply();}
  if(verb==='auto'){
    if(!no&&(!integer(value,1,cfg.maxDns)||!integer(extra,Number(value),cfg.maxDns)))
      return invalid('Use a DN tag range within max-dn.');
    if(no)delete cfg.assign;else cfg.assign={first:Number(value),last:Number(extra)};
    return reply();
  }
  if(verb==='create'){
    if(no){delete cfg.files;return reply('Removed the SCCP phone configuration files.');}
    if(!cfg.source)return invalid('Set ip source-address before creating the phone files.');
    cfg.files={address:cfg.source,port:cfg.port};
    return reply('SCCP configuration files generated in system:/its/.');
  }
  if(verb==='restart'||verb==='reset')return restartPhones(lab,d,Object.values(cfg.phones),verb==='reset');
  return null;
}

function cmeShow(lab,router,args,c) {
  const cfg=router.cme;
  if(c==='show telephony-service events'){
    refreshCalls(lab,router);return reply(voiceLog(router));
  }
  if(args[1]==='call'){
    const active=refreshCalls(lab,router);
    const history=args[2]==='history';
    const calls=history?(router.cmeRuntime?.calls??[]).filter(call=>!active.includes(call)):active;
    return reply(calls.length?callTable(calls):(history?'No call history entries.':'No active voice calls.'));
  }
  if(!cfg)return reply('Cisco Unified CME is not configured.');
  if(c==='show telephony-service tftp-bindings'){
    if(!cfg.files)return reply('No SCCP configuration files. Run create cnf-files.');
    return reply(cmeTftpFiles(router).map(name=>'tftp-server system:/its/'+name+' alias '+name).join('\n'));
  }
  if(args[1]==='telephony-service'){
    const regs=lab.devices.filter(phone=>phone.type==='phone'&&registrationStatus(lab,phone,router).ok);
    const lines=['Cisco Unified CME · SCCP (LabSim)',
      'Source address: '+(cfg.source?cfg.source+' port '+cfg.port:'Unconfigured'),
      'SCCP listener: '+(activeSource(lab,router)?'UP':'DOWN'),
      'Max ephones: '+cfg.maxPhones+'   Configured: '+Object.keys(cfg.phones).length+'   Registered: '+regs.length,
      'Max DNs: '+cfg.maxDns+'   Configured: '+Object.keys(cfg.dns).length,
      'Keepalive interval: '+(cfg.keepalive??cmeDefaults.keepalive)+' seconds',
      'Auto registration: '+(cfg.autoRegister?'Enabled':'Disabled'),
      'Auto assign DN tags: '+(cfg.assign?cfg.assign.first+' to '+cfg.assign.last:'Disabled'),
      'SCCP configuration files: '+(!cfg.files?'Not generated':cfg.files.address===cfg.source&&cfg.files.port===cfg.port?'Ready':'Stale — rerun create cnf-files')];
    return reply([...lines,...(args[2]==='all'?['',...cmeRunning(router)]:[])].join('\n'));
  }
  if(c==='show ephone attempted-registrations'){
    const attempts=router.cmeRuntime?.attempts??[];
    return reply(attempts.length?['MAC Address       IP Address       Last attempt',...attempts.map(row=>row.mac+'   '+(row.ip??'unassigned').padEnd(16)+row.reason)].join('\n'):'No rejected ephone registrations.');
  }
  const active=refreshCalls(lab,router);
  if(c==='show ephone rtp connections'){
    const connected=active.filter(call=>call.state==='CONNECTED');
    return reply(connected.length?callTable(connected):'No active RTP connections.');
  }
  if(args[1]==='ephone-dn'){
    const lines=entries(cfg.dns,args[2]);
    return reply(lines.length?lines.map(([tag,line])=>{
      const buttons=entries(cfg.phones).flatMap(([phone,record])=>Object.entries(record.buttons).filter(([,dn])=>dn===Number(tag)).map(([b])=>phone+':'+b));
      return ['ephone-dn '+tag+'  '+(line.channels??'single-line'),
        ' Number: '+(line.number??'Unassigned')+(line.secondary?'  Secondary: '+line.secondary:''),
        ...(line.name?[' Name: '+line.name]:[]),...(line.label?[' Label: '+line.label]:[]),
        ' Ephone:button: '+(buttons.join(', ')||'None'),
        ' Call state: '+(active.find(call=>[line.number,line.secondary].some(num=>num&&(call.from===num||call.to===num)))?.state??'IDLE')].join('\n');
    }).join('\n\n'):'No matching ephone DNs.');
  }
  const filter=args[2];
  const rows=entries(cfg.phones,/^\d+$/.test(filter??'')?filter:null).flatMap(([tag,record])=>{
    const slave=record.mac&&lab.devices.find(phone=>phone.type==='phone'&&phoneMac(phone)===record.mac);
    const status=slave&&registrationStatus(lab,slave,router);
    const online=Boolean(status?.ok);
    const call=slave&&active.find(row=>row.caller===slave.id||row.callee===slave.id);
    const ringing=call?.state==='RINGING'&&call.callee===slave.id;
    const lines=phoneLines(cfg,record);
    if((filter==='registered'&&!online)||(filter==='unregistered'&&online)||(filter==='ringing'&&!ringing)||(filter==='offhook'&&call?.state!=='CONNECTED')||
      (filter==='dn'&&!lines.some(line=>line.dn===Number(args[3]))))return [];
    return [{tag,record,slave,online,call,ringing,lines}];
  });
  if(!rows.length)return reply(filter==='registered'?'No registered SCCP phones.':'No matching SCCP phones.');
  if(filter==='summary'||args[3]==='summary'){
    return reply(['PhoneType Ephone  MacAddress      IpAddress        Ln  Dn    Number        Status',...rows.flatMap(row=>
      (row.lines.length?row.lines:[{}]).map(({button,dn,line})=>[
        (row.record.model??cmeDefaults.model).padEnd(10),row.tag.padEnd(8),(row.record.mac??'Unassigned').padEnd(16),
        (row.slave&&hostIp(row.slave)||'-').padEnd(17),String(button??'-').padEnd(4),String(dn??'-').padEnd(6),
        (line?.number??'-').padEnd(14),statusText(row.online)
      ].join('')))].join('\n'));
  }
  return reply(rows.map(({tag,record,slave,online,call,ringing,lines})=>[
    'ephone-'+tag+' Mac:'+(record.mac??'Unassigned')+' '+statusText(online),
    ' mediaActive:'+Number(call?.state==='CONNECTED')+'  offhook:'+Number(Boolean(call&&!ringing))+'  ringing:'+Number(ringing),
    ' IP:'+(slave&&hostIp(slave)||'0.0.0.0')+'  SCCP '+(record.model??cmeDefaults.model)+'  keepalive '+(record.keepalive??cfg.keepalive??cmeDefaults.keepalive)+' sec',
    ...lines.map(({button,dn,line})=>' button '+button+': dn '+dn+' number '+line.number+(line.label?' '+line.label:'')+'  '+(call?.state??'IDLE'))
  ].join('\n')).join('\n\n'));
}

export function cmeCLI(lab,d,s,args,c) {
  if(d.type!=='router')return null;
  if(/^show (telephony-service|ephone(?:-dn)?|call (active|history) voice)(?: |$)/.test(c))return cmeShow(lab,d,args,c);
  if(c==='clear telephony-service ephone-attempted-registrations'){
    if(d.cmeRuntime)d.cmeRuntime.attempts=[];
    return reply('Cleared attempted SCCP registrations.');
  }
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [verb,arg,mode]=w;
  if(s.mode==='global'&&verb==='telephony-service'){
    if(no){
      for(const phone of lab.devices)clearPhoneCalls(lab,d,phone,'Telephony service was removed.');
      delete d.cme;
      if(d.cmeRuntime)d.cmeRuntime.registrations={};
      return reply();
    }
    d.cme??=blankCme();
    return enter(s,'telephony');
  }
  if(s.mode==='global'&&['ephone','ephone-dn'].includes(verb)){
    const phone=verb==='ephone',cfg=d.cme;
    const max=phone?cfg?.maxPhones:cfg?.maxDns;
    if(!max||!integer(arg,1,max))return invalid('Set '+(phone?'max-ephones':'max-dn')+' under telephony-service and use a tag within that range.');
    const tag=Number(arg),list=phone?cfg.phones:cfg.dns;
    if(no){
      delete list[tag];
      if(!phone)for(const row of Object.values(cfg.phones)){
        for(const [button,assigned] of Object.entries(row.buttons))if(assigned===tag)delete row.buttons[button];
      }
      return reply();
    }
    const record=list[tag]??=(phone?{buttons:{}}:{});
    if(mode)record.channels=mode;
    return enter(s,phone?'ephone':'ephoneDn',tag);
  }
  if(s.mode==='telephony')return d.cme?telephonyConfig(lab,d,d.cme,w,no):invalid('Telephony service was removed. Exit and configure it again.');
  if(s.mode==='ephone'){
    const record=own(d.cme?.phones,s.current);
    return record?ephoneConfig(lab,d,record,w,no):invalid('This ephone was removed.');
  }
  if(s.mode==='ephoneDn'){
    const line=own(d.cme?.dns,s.current);
    return line?dnConfig(line,w,no):invalid('This ephone DN was removed.');
  }
  return null;
}

export function cmeRunning(d) {
  const cfg=d.cme;
  if(!cfg)return [];
  return ['telephony-service',
    ...(cfg.maxPhones?[' max-ephones '+cfg.maxPhones]:[]),...(cfg.maxDns?[' max-dn '+cfg.maxDns]:[]),
    ...(cfg.source?[' ip source-address '+cfg.source+' port '+cfg.port]:[]),
    ...(cfg.keepalive?[' keepalive '+cfg.keepalive]:[]),
    ...(cfg.autoRegister?[]:[' no auto-reg-ephone']),
    ...(cfg.assign?[' auto assign '+cfg.assign.first+' to '+cfg.assign.last]:[]),
    ...(cfg.files?[' create cnf-files']:[]),
    ...entries(cfg.dns).flatMap(([tag,line])=>[
      'ephone-dn '+tag+(line.channels?' '+line.channels:''),
      ...(line.number?[' number '+line.number+(line.secondary?' secondary '+line.secondary:'')]:[]),
      ...['name','label','description'].filter(key=>line[key]).map(key=>' '+key+' '+line[key]),
      ...(line.forwardAll?[' call-forward all '+line.forwardAll]:[]),...(line.forwardBusy?[' call-forward busy '+line.forwardBusy]:[])
    ]),
    ...entries(cfg.phones).flatMap(([tag,record])=>[
      'ephone '+tag,...(record.mac?[' mac-address '+record.mac]:[]),...(record.model?[' type '+record.model]:[]),
      ...(record.keepalive?[' keepalive '+record.keepalive]:[]),
      ...(Object.keys(record.buttons).length?[' button '+Object.entries(record.buttons).map(([b,dn])=>b+':'+dn).join(' ')]:[])
    ])
  ];
}
