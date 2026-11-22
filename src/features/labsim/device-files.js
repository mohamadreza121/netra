import { addDevice, deviceById, emptyLab, models } from './network.js';
import { servicePath } from './services.js';
import { interfaceName } from './ios.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const safeFile=/^(?:flash|bootflash):(?:\/)?([a-z0-9][a-z0-9_.-]{0,47})$/i;
const tftpPath=/^tftp:\/\/([\d.]+)\/([a-z0-9][a-z0-9_.-]{0,47})$/i;
const preserve=new Set(['id','type','slot','x','y','startup','startupState','flash','archiveFiles',
  'arp','macTable','ndCache','log','aaaStats','urpfDrops','ipFlowEvents']);
const dynamicPortFields=['authentication','secureDynamic'];
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

export const deviceFilesIOS={
  operational:['show file systems','show bootvar','show boot','dir [<filesystem>]','show flash','show archive','show clock detail'],
  exec:['archive config','copy startup-config running-config','copy startup-config <destination>',
    'copy <origin> running-config','copy <origin> startup-config','configure replace <origin> [force]',
    'erase startup-config','write erase','reload','clock set <time> <day> <month> <year>'],
  global:['archive','boot system [flash] <filesystem-and-image>','no boot system','config-register <value>',
    'enable secret [0] <lab-password>','no enable secret',
    'ip tftp source-interface <interface...>','no ip tftp source-interface',
    'clock timezone <label> <hours> [<minutes>]','no clock timezone'],
  archive:['path <prefix>','maximum <count>','write-memory','no write-memory']
};

function snapshot(d) {
  const data=structuredClone(Object.fromEntries(Object.entries(d).filter(([key])=>!preserve.has(key))));
  for(const p of Object.values(data.ports)){
    for(const key of dynamicPortFields)delete p[key];
    if(p.security){
      if(p.security.sticky)p.security.static=[...new Set([...(p.security.static??[]),...(p.security.learned??[])])];
      delete p.security.learned;delete p.security.violations;delete p.security.disabled;
    }
    if(p.gre)delete p.gre.counters;
    if(p.nhrp)delete p.nhrp.shortcuts;
  }
  if(data.aaa)delete data.aaa.sessions;
  if(data.qos)delete data.qos.stats;
  if(data.nat)delete data.nat.translations;
  if(data.host){delete data.host.lease;delete data.host.lease6;delete data.host.wifi;}
  if(data.flow){
    for(const monitor of Object.values(data.flow.monitors??{}))delete monitor.cache;
    for(const exporter of Object.values(data.flow.exporters??{}))delete exporter.exported;
  }
  return data;
}

function update(d,data,replace) {
  if(replace)for(const key of Object.keys(d))if(!preserve.has(key))delete d[key];
  Object.assign(d,structuredClone(Object.fromEntries(Object.entries(data).filter(([key])=>!preserve.has(key)&&keyName(key)))));
  for(const key of ['arp','macTable','ndCache'])delete d[key];
}

function archiveConfig(d,running) {
  const cfg=d.fileArchive;
  if(!cfg?.prefix)return invalid('Configure an archive path in local flash.');
  const index=d.archiveFiles??={next:0,names:[]};
  const name=cfg.prefix+'-'+(++index.next)+'.cfg';
  const storage=d.flash??={};
  storage[name]={text:running(d),config:snapshot(d)};
  index.names.push(name);
  while(index.names.length>(cfg.maximum??10))delete storage[index.names.shift()];
  return reply('Archived configuration to flash:'+name+'.');
}

function saveStartupConfig(d,running) {
  d.startup=running(d);d.startupState=snapshot(d);
  if(d.fileArchive?.auto&&d.fileArchive.prefix)archiveConfig(d,running);
  return reply('Building configuration...\n[OK]');
}

function localEntry(d,source) {
  if(source==='startup-config')return {text:d.startup,config:d.startupState};
  const file=safeFile.exec(source);
  return file?own(d.flash,file[1]):null;
}

function openEntry(lab,d,source) {
  const local=localEntry(d,source);
  if(local?.text)return {entry:local,path:[d.id]};
  const match=tftpPath.exec(source);
  if(!match)return {reason:'Configuration file is unavailable.'};
  const port=d.bootInfo?.tftpSource;
  const address=port?d.ports[port]?.address:undefined;
  if(port&&!address)return {reason:'The TFTP source interface has no IPv4 address.'};
  const hit=servicePath(lab,d,match[1],'tftp',address);
  if(!hit.ok)return {reason:hit.reason,path:hit.path};
  const text=own(hit.destination.files,match[2]);
  const config=own(hit.destination.configBackups,match[2]);
  return text?{entry:{text,config},path:hit.path}:{reason:'File not found on the lab TFTP server.',path:hit.path};
}

function replaceConfig(lab,d,input,replace,dispatch) {
  const lines=input.split(/\r?\n/);
  if(input.length>64000||lines.length>1000)return invalid('The lab configuration is too large.');
  const draft=structuredClone(lab),device=deviceById(draft,d.id);
  if(replace){
    const blank=addDevice(emptyLab(),d.type);
    blank.name=d.name;
    update(device,snapshot(blank),true);
  }
  const session={mode:'global',current:null,history:[]};
  const contexts=[{indent:-1,mode:'global',current:null,parents:[]}];
  for(const raw of lines){
    const command=raw.trim();
    if(!command||command.startsWith('!')||command==='end'||command==='exit-address-family')continue;
    if(/^(?:do |configure |copy |reload|erase|write )/.test(command)||command.includes('[configured]')){
      return invalid('This file contains an EXEC-only command or a redacted secret. No changes applied.');
    }
    const indent=raw.search(/\S/);
    while(contexts.length>1&&contexts.at(-1).indent>=indent)contexts.pop();
    const {mode,current,parents}=contexts.at(-1);
    Object.assign(session,{mode,current,parents:[...parents]});
    const response=dispatch(draft,device,session,command);
    if(response.text.startsWith('%'))return invalid('Configuration failed at "'+command+'". No changes applied.');
    if(session.mode!==mode)contexts.push({indent,mode:session.mode,current:session.current,parents:[...(session.parents??[])]});
  }
  update(d,snapshot(device),replace);
  return reply('Configuration applied.');
}

function loadState(lab,d,entry,replace,dispatch) {
  if(!entry?.text)return invalid('Configuration file is unavailable.');
  if(entry.config){
    if(!Object.keys(d.ports).filter(name=>models[d.type].ports.includes(name)).every(name=>typeof entry.config.ports?.[name]?.up==='boolean'))
      return invalid('This configuration is for a different lab platform.');
    const hostname=entry.config.name;
    if(!/^[\w-]{1,32}$/.test(hostname??'')||lab.devices.some(peer=>peer!==d&&peer.name.toLowerCase()===hostname.toLowerCase()))
      return invalid('The backup hostname must be unique in this topology.');
    if(replace){update(d,entry.config,true);return reply('Configuration replaced.');}
    // For an IOS merge, replay the rendered file so commands already in memory that are
    // absent from the saved file remain. Lab secrets are restored from the snapshot.
    const safe=entry.text.split('\n').filter(line=>!line.includes('[configured]')).join('\n');
    const output=replaceConfig(lab,d,safe,false,dispatch);
    if(!output.text.startsWith('%')){
      for(const key of ['aaa','ipsec','keyChains'])if(entry.config[key]){
        d[key]={...d[key],...structuredClone(entry.config[key])};
      }
      if(entry.config.enableSecret)d.enableSecret=entry.config.enableSecret;
    }
    return output;
  }
  return replaceConfig(lab,d,entry.text,replace,dispatch);
}

export function deviceClock(d,reference=Date.now()) {
  const clock=d.clock;
  const now=clock?.manual!==undefined?clock.manual+reference-clock.setAt:reference;
  return {
    now,offset:clock?.timezone?.offset??0,label:clock?.timezone?.label??'UTC'
  };
}
export function clockDisplay(d) {
  const {now,offset,label}=deviceClock(d);
  return new Date(now+offset*60000).toISOString().replace('T',' ').replace('Z',' '+label);
}

export function deviceFilesCLI(lab,d,s,args,c,running,dispatch) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [verb,operation,source,value,extra]=w;
  if(c==='show clock')return reply(clockDisplay(d));
  if(c==='show file systems')return reply('flash:     rw  LabSim flash\nnvram:     rw  Startup configuration\ntftp:      rw  LabSim TFTP service');
  if(c==='show bootvar'||c==='show boot'){
    const boot=d.bootInfo;
    return reply('BOOT variable = '+(boot?.image??'LabSim built-in device model')+'\nConfiguration register is '+(boot?.register??'0x2102'));
  }
  if(c==='dir nvram:'||c==='dir nvram:/'){
    return reply('Directory of nvram:/'+(d.startup?'\n'+d.startup.length+' bytes  startup-config':'\nNo startup configuration.'));
  }
  if(c==='show flash'||c==='dir'||c.startsWith('dir ')){
    if(operation&&!/^(?:flash|bootflash):\/?$/.test(operation)&&!safeFile.test(operation))return invalid('Specify flash:, bootflash: or nvram:.');
    const rows=Object.entries(d.flash??{}).filter(([name])=>!operation||/^(?:flash|bootflash):\/?$/.test(operation)||safeFile.exec(operation)?.[1]===name);
    return reply(['Directory of flash:/',...rows.map(([name,file])=>String(file.text.length).padStart(7)+' bytes  '+name)].join('\n'));
  }
  if(c==='show archive')return reply((d.archiveFiles?.names??[]).map(name=>'flash:'+name).join('\n')||'No archived configurations.');
  if(s.mode==='exec'){
    if(c==='copy running-config startup-config'||c==='write memory')return saveStartupConfig(d,running);
    if(c==='archive config')return archiveConfig(d,running);
    if(c==='erase startup-config'||c==='write erase'){delete d.startup;delete d.startupState;return reply('Startup configuration erased in this lab device.');}
    if(c==='reload'){
      if(d.startup){
        const result=loadState(lab,d,{text:d.startup,config:d.startupState},true,dispatch);
        if(result.text.startsWith('%'))return result;
      }else{
        const blank=addDevice(emptyLab(),d.type);blank.name=models[d.type].prefix+d.slot;
        update(d,snapshot(blank),true);
      }
      s.mode='user';s.current=null;s.parents=[];return reply('LabSim device restarted.');
    }
    if(c.startsWith('clock set ')){
      const [hh,mm,ss,rest]=source.split(':');
      const month=months.indexOf(extra?.slice(0,3).toLowerCase());
      const year=Number(w[5]),day=Number(value);
      if(rest!==undefined||!integer(hh,0,23)||!integer(mm,0,59)||!integer(ss,0,59)||!integer(value,1,31)||!integer(w[5],1990,2099)||month<0)
        return invalid('Use clock set HH:MM:SS DAY MONTH YEAR.');
      const clock=d.clock??={};
      const manual=Date.UTC(year,month,day,Number(hh),Number(mm),Number(ss));
      if(new Date(manual).getUTCDate()!==day)return invalid('This day is outside the selected month.');
      clock.manual=manual-(clock.timezone?.offset??0)*60000;clock.setAt=Date.now();return reply(clockDisplay(d));
    }
    if(verb==='configure'&&operation==='replace'){
      const input=openEntry(lab,d,source);
      return input.entry?loadState(lab,d,input.entry,true,dispatch):invalid(input.reason);
    }
    if(verb==='copy'){
      const output=safeFile.exec(source);
      if(operation==='running-config'&&output){
        (d.flash??={})[output[1]]={text:running(d),config:snapshot(d)};return reply('Copied running-config to flash:'+output[1]+'.');
      }
      if(source==='running-config'){
        const result=openEntry(lab,d,operation);
        return result.entry?loadState(lab,d,result.entry,false,dispatch):invalid(result.reason);
      }
      if(source==='startup-config'&&operation!=='running-config'){
        const result=openEntry(lab,d,operation);
        if(!result.entry)return invalid(result.reason);
        if(result.entry.config){d.startup=result.entry.text;d.startupState=structuredClone(result.entry.config);return reply('[OK]',result.path);}
        const twin=structuredClone(lab),draft=deviceById(twin,d.id);
        const apply=replaceConfig(twin,draft,result.entry.text,true,dispatch);
        if(apply.text.startsWith('%'))return apply;
        d.startup=running(draft);d.startupState=snapshot(draft);return reply('[OK]',result.path);
      }
      const text=operation==='startup-config'?d.startup:operation==='running-config'?running(d):null;
      const target=tftpPath.exec(source);
      if(typeof text==='string'&&target){
        const port=d.bootInfo?.tftpSource,address=port?d.ports[port]?.address:undefined;
        if(port&&!address)return invalid('The TFTP source interface has no IPv4 address.');
        const hit=servicePath(lab,d,target[1],'tftp',address);
        if(!hit.ok)return invalid(hit.reason);
        const server=hit.destination;
        (server.files??={})[target[2]]=text;
        (server.configBackups??={})[target[2]]=operation==='running-config'?snapshot(d):d.startupState;
        return reply('File written to '+server.name+'.',hit.path);
      }
      if(operation==='startup-config'&&output&&d.startup){
        (d.flash??={})[output[1]]={text:d.startup,config:structuredClone(d.startupState)};return reply('Copied startup configuration.');
      }
      return invalid('Use a configured file and a flash or tftp://SERVER-IP/FILENAME destination.');
    }
  }
  if(s.mode==='global'){
    if(verb==='archive'){d.fileArchive??={};return enter(s,'archive');}
    if(verb==='enable'&&operation==='secret'){
      if(no){delete d.enableSecret;return reply();}
      const secret=w.at(-1);
      if(secret.length<1||secret.length>64)return invalid('Use a lab secret up to 64 characters.');
      d.enableSecret=secret;return reply();
    }
    if(verb==='boot'){
      const cfg=d.bootInfo??={};
      const image=source==='flash'?value:source;
      if(no)delete cfg.image;else if(safeFile.test(image))cfg.image=image;else return invalid('Use a valid flash image path.');
      return reply();
    }
    if(verb==='config-register'){
      if(!/^0x[\da-f]{1,4}$/i.test(operation))return invalid('Use a hex configuration register such as 0x2102.');
      (d.bootInfo??={}).register=operation.toLowerCase();return reply();
    }
    if(verb==='ip'&&operation==='tftp'){
      const cfg=d.bootInfo??={};
      if(no){delete cfg.tftpSource;return reply();}
      const port=interfaceName(w.slice(3));
      if(!port||!d.ports[port])return invalid('Select an existing source interface.');
      cfg.tftpSource=port;return reply();
    }
    if(verb==='clock'&&operation==='timezone'){
      const clock=d.clock??={};
      if(no)delete clock.timezone;
      else if(keyName(source)&&/^-?\d{1,2}$/.test(value??'')&&Number(value)>=-23&&Number(value)<=23&&integer(extra??'0',0,59)){
        clock.timezone={label:source,offset:Number(value)*60+(value.startsWith('-')?-1:1)*Number(extra??0)};
      }else return invalid('Use a timezone label, UTC hour offset and optional minutes.');
      return reply();
    }
  }
  if(s.mode==='archive'){
    const cfg=d.fileArchive;
    if(verb==='path'&&safeFile.test(operation)&&safeFile.exec(operation)[1].length<=32){cfg.prefix=safeFile.exec(operation)[1];return reply();}
    if(verb==='maximum'&&integer(operation,1,14)){cfg.maximum=Number(operation);return reply();}
    if(verb==='write-memory'){cfg.auto=!no;return reply();}
    return invalid('Use a local flash archive path or a maximum from 1 to 14.');
  }
  return null;
}

export function deviceFilesRunning(d) {
  const boot=d.bootInfo,archive=d.fileArchive,zone=d.clock?.timezone;
  const sign=zone?.offset<0?'-':'',hours=Math.floor(Math.abs(zone?.offset??0)/60);
  return [
    ...(d.enableSecret?['enable secret [configured]']:[]),
    ...(boot?.image?['boot system '+boot.image]:[]),...(boot?.register?['config-register '+boot.register]:[]),
    ...(boot?.tftpSource?['ip tftp source-interface '+boot.tftpSource]:[]),
    ...(zone?['clock timezone '+zone.label+' '+sign+hours+' '+Math.abs(zone.offset)%60]:[]),
    ...(archive?.prefix?['archive',' path flash:'+archive.prefix,...(archive.maximum?[' maximum '+archive.maximum]:[]),
      ...(archive.auto?[' write-memory']:[])]:[])
  ];
}
