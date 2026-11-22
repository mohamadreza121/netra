import { deviceById, hostIp, ipv4, linkUp, macAddress, requestDhcp, transaction } from './network.js';
import { own } from './cli-utils.js';
import { appendLog } from './services.js';

export const cmeDefaults = { port:2000, keepalive:30, model:'7960' };
export const phoneMac = phone => macAddress(phone).toUpperCase();
export const blankCme = () => ({maxPhones:0,maxDns:0,autoRegister:true,dns:{},phones:{}});
export const phoneSettings = phone => phone.host.cme??={};

export function cmeState(router) {
  return router.cmeRuntime??={registrations:{},attempts:[],calls:[],events:[],nextEvent:1,nextCall:1};
}

export function voiceEvent(router,phones,text,callId) {
  const state=cmeState(router);
  state.events.push({seq:state.nextEvent++,phones:phones.map(phone=>phone.id),text,callId});
  if(state.events.length>100)state.events.shift();
  if((router.logging?.bufferLevel??6)>=6)appendLog(router,{device:router.name,priority:6,message:'%CME-6-LABVOICE: '+text});
}

export function phoneLocalEvent(phone,text) {
  const settings=phoneSettings(phone);
  settings.localEvents=[...(settings.localEvents??[]).slice(-11),text];
}

export function cmeTftpFiles(router) {
  const cfg=router.cme;
  return cfg?.files?['XMLDefault.cnf.xml',...Object.values(cfg.phones).filter(row=>row.mac)
    .map(row=>'SEP'+row.mac.replaceAll('.','')+'.cnf.xml')]:[];
}

export function cmeTftpFile(router,filename) {
  if(!cmeTftpFiles(router).some(name=>name.toLowerCase()===filename.toLowerCase()))return undefined;
  const {address,port}=router.cme.files;
  return ['<device>','  <deviceProtocol>SCCP</deviceProtocol>',
    '  <processNodeName>'+address+'</processNodeName>',
    '  <ethernetPhonePort>'+port+'</ethernetPhonePort>','</device>'].join('\n');
}

export const tftpAddress = phone => phone.host.cme?.tftp??phone.host.lease?.tftp;
export function usesCme(lab,phone) {
  return phone.host.cme?.mode==='sccp'||(!phone.host.sip&&Boolean(tftpAddress(phone)||lab.scenario==='voice-cme'));
}

function owner(lab,address) {
  return address&&lab.devices.find(d=>d.type==='router'&&Object.values(d.ports).some(p=>p.address===address&&!p.vrf));
}

export function cmeRouter(lab,phone) {
  return deviceById(lab,phone.host.cme?.router)??owner(lab,tftpAddress(phone));
}

export function cmeSourceUp(lab,router,address) {
  return Boolean(address&&Object.entries(router.ports).some(([name,p])=>p.address===address&&!p.vrf&&linkUp(lab,router,name)));
}

function signal(lab,phone,address,port,protocol) {
  return transaction(lab,phone,address,{packet:{protocol,sourcePort:49152+phone.slot,destinationPort:port}});
}

export function registrationStatus(lab,phone,router=cmeRouter(lab,phone)) {
  const settings=phone.host.cme;
  const row=router?.cmeRuntime?.registrations?.[phone.id];
  const cfg=router?.cme;
  const record=own(cfg?.phones,row?.tag);
  const fail=(reason,path=[phone.id])=>({ok:false,reason,path,router});
  if(!row)return fail(settings?.reason??'Phone has not registered. Boot the phone or renew DHCP.');
  if(!cfg?.source||row.address!==cfg.source||row.port!==cfg.port||!cmeSourceUp(lab,router,cfg.source))
    return fail('SCCP source address or port is unavailable or has changed.');
  if(!record||record.mac!==phoneMac(phone)||row.ip!==hostIp(phone))
    return fail('The ephone mapping or phone IP changed. Register again.');
  const hit=signal(lab,phone,cfg.source,cfg.port,'tcp');
  if(!hit.ok)return fail('SCCP signaling failed. '+hit.reason,hit.path);
  if(hit.destination!==router)return fail('SCCP reached the wrong device.',hit.path);
  return {ok:true,router,tag:row.tag,record,path:hit.path};
}

export function phoneLines(cfg,record) {
  return Object.entries(record?.buttons??{}).flatMap(([button,dn])=>{
    const line=own(cfg.dns,dn);
    return line?.number?[{button:Number(button),dn,line}]:[];
  });
}

function registerRecord(cfg,phone) {
  const mac=phoneMac(phone);
  let entry=Object.entries(cfg.phones).find(([,record])=>record.mac===mac);
  if(!entry){
    if(!cfg.autoRegister)return {reason:'Automatic registration is disabled and the MAC is not configured.'};
    let tag=1;
    const limit=Math.min(cfg.maxPhones,250);
    while(tag<=limit&&own(cfg.phones,tag))tag++;
    if(!(tag<=limit))return {reason:'No free ephone slot. Check max-ephones and existing ephones.'};
    entry=[String(tag),cfg.phones[tag]={mac,model:cmeDefaults.model,buttons:{}}];
  }
  const [tag,record]=entry;
  if(!Object.keys(record.buttons).length&&cfg.assign){
    const assigned=new Set(Object.values(cfg.phones).flatMap(row=>Object.values(row.buttons)));
    const dn=Object.keys(cfg.dns).map(Number).find(n=>n>=cfg.assign.first&&n<=cfg.assign.last&&cfg.dns[n].number&&!assigned.has(n));
    if(dn!==undefined)record.buttons[1]=dn;
  }
  return {tag:Number(tag),record};
}

export function unregisterCme(lab,phone) {
  const prior=deviceById(lab,phone.host.cme?.router);
  if(prior?.cmeRuntime)delete prior.cmeRuntime.registrations[phone.id];
}

export function registerCme(lab,phone) {
  const address=tftpAddress(phone);
  const router=owner(lab,address);
  const settings=phoneSettings(phone);
  unregisterCme(lab,phone);
  settings.mode='sccp';
  settings.router=router?.id;
  if(router)settings.lastRouter=router.id;
  const fail=(reason,path=[phone.id],attempt=false)=>{
    settings.reason=reason;
    if(router){
      voiceEvent(router,[phone],phone.name+' registration failed: '+reason);
      if(attempt){
        const attempts=cmeState(router).attempts;
        attempts.push({mac:phoneMac(phone),ip:hostIp(phone),reason});
        if(attempts.length>30)attempts.shift();
      }
    }else phoneLocalEvent(phone,'Registration failed: '+reason);
    return {ok:false,text:'SCCP registration failed: '+reason,path,router};
  };
  if(!hostIp(phone))return fail('No IPv4 address. Check the voice VLAN and DHCP.');
  if(!address)return fail('No TFTP server. Configure DHCP option 150 or a static TFTP server.');
  if(ipv4(address)===null)return fail('Invalid TFTP server address.');
  const download=signal(lab,phone,address,69,'udp');
  if(!download.ok)return fail('TFTP '+address+' is unreachable. '+download.reason,download.path);
  const cfg=router?.cme;
  if(!router||download.destination!==router||!cmeTftpFile(router,'XMLDefault.cnf.xml'))return fail('No CME configuration files at '+address+'. Run create cnf-files.',download.path);
  if(cfg.files.address!==cfg.source||cfg.files.port!==cfg.port)
    return fail('The TFTP profile is stale. Regenerate it with create cnf-files.',download.path);
  if(!cmeSourceUp(lab,router,cfg.source))return fail('The CME source interface is down or unassigned.',download.path);
  const hit=signal(lab,phone,cfg.files.address,cfg.files.port,'tcp');
  if(!hit.ok)return fail('SCCP TCP/'+cfg.files.port+' failed. '+hit.reason,hit.path);
  if(hit.destination!==router)return fail('SCCP reached the wrong device.',hit.path);
  const provisioned=registerRecord(cfg,phone);
  if(provisioned.reason)return fail(provisioned.reason,hit.path,true);
  const {tag,record}=provisioned;
  cmeState(router).registrations[phone.id]={tag,ip:hostIp(phone),address:cfg.source,port:cfg.port};
  delete settings.reason;
  if(phone.host.sip){
    const sipServer=deviceById(lab,phone.host.sip.server);
    if(sipServer?.registrations?.[phone.host.extension]===phone.id)delete sipServer.registrations[phone.host.extension];
    delete phone.host.sip;delete phone.host.call;
  }
  const lines=phoneLines(cfg,record).map(({line})=>line.number).join(', ');
  const text=phone.name+' registered as ephone '+tag+(lines?' with extension '+lines:' with no line assigned. Check auto assign or button mappings.');
  voiceEvent(router,[phone],text);
  return {ok:true,text:'TFTP profile downloaded from '+address+'\nSCCP TCP/'+cfg.port+' · '+text,path:hit.path,router};
}

export function bootCme(lab,phone) {
  const lease=phone.host.ip?null:requestDhcp(lab,phone);
  const boot=registerCme(lab,phone);
  return {...boot,text:[lease&&(lease.ok?'DHCP lease: '+lease.ip+' from '+lease.server:lease.reason),boot.text].filter(Boolean).join('\n'),
    path:boot.path.length>1?boot.path:lease?.path??boot.path};
}
