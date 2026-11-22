import { deviceById, hostIp, transaction } from './network.js';
import { invalid, reply } from './cli-utils.js';
import { cmeRouter, cmeState, phoneLines, phoneLocalEvent, registrationStatus, voiceEvent } from './cme.js';

const inProgress=call=>['RINGING','CONNECTED'].includes(call.state);
const party=(call,phone)=>call.caller===phone.id||call.callee===phone.id;
const matches=(line,number)=>line.number===number||line.secondary===number;

function mediaPath(lab,caller,callee,observe=false) {
  const hit=transaction(lab,caller,hostIp(callee),{observe,packet:{
    protocol:'udp',sourcePort:16384+2*caller.slot,destinationPort:16384+2*callee.slot,dscp:46
  }});
  return hit.ok&&hit.destination!==callee?{...hit,ok:false,reason:'RTP reached the wrong destination.'}:hit;
}

function event(lab,router,call,detail) {
  const phones=[call.caller,call.callee].map(id=>deviceById(lab,id)).filter(Boolean);
  voiceEvent(router,phones,`Call ${call.id} ${call.from} -> ${call.to} · ${detail}`,call.id);
}

function finish(lab,router,call,state,reason) {
  call.state=state;call.detail=reason;
  event(lab,router,call,state+' · '+reason);
}

function record(router,caller,number,local,callee) {
  const state=cmeState(router);
  const call={id:state.nextCall++,caller:caller.id,callee:callee?.id,from:local?.number??caller.name,to:number,state:'SETUP'};
  state.calls.push(call);
  if(state.calls.length>40){
    const old=state.calls.findIndex(row=>row!==call&&!inProgress(row));
    if(old>=0)state.calls.splice(old,1);
  }
  return call;
}

export function clearPhoneCalls(lab,router,phone,reason) {
  for(const call of router?.cmeRuntime?.calls??[]){
    if(inProgress(call)&&party(call,phone))finish(lab,router,call,'DISCONNECTED',reason);
  }
}

export function refreshCalls(lab,router) {
  const active=(router?.cmeRuntime?.calls??[]).filter(inProgress);
  for(const call of active){
    const from=deviceById(lab,call.caller),to=deviceById(lab,call.callee);
    const source=from&&registrationStatus(lab,from,router),destination=to&&registrationStatus(lab,to,router);
    if(!source?.ok||!destination?.ok){
      finish(lab,router,call,'DISCONNECTED','SCCP signaling was lost.');continue;
    }
    if(!phoneLines(router.cme,source.record).some(({line})=>matches(line,call.from))||
      !phoneLines(router.cme,destination.record).some(({line})=>matches(line,call.connectedTo??call.to))){
      finish(lab,router,call,'DISCONNECTED','A line assignment changed.');continue;
    }
    if(call.state==='CONNECTED'){
      const media=mediaPath(lab,from,to);
      if(!media.ok)finish(lab,router,call,'DISCONNECTED','RTP media was lost. '+media.reason);
    }
  }
  return active.filter(inProgress);
}

export function callDetails(lab,router,phone) {
  const active=refreshCalls(lab,router);
  const rows=phone?active.filter(row=>party(row,phone)):active;
  return rows;
}

export function callTable(calls) {
  const header='Call ID  Calling        Called         State         Detail';
  return [header,...calls.map(call=>[
    String(call.id).padEnd(9),call.from.padEnd(15),(call.connectedTo&&call.connectedTo!==call.to?call.to+'>'+call.connectedTo:call.to).padEnd(15),call.state.padEnd(14),call.detail
  ].join(''))].join('\n');
}

export function voiceLog(router,phone) {
  const events=(router?.cmeRuntime?.events??[]).filter(event=>!phone||event.phones.includes(phone.id));
  return events.length?events.map(event=>String(event.seq).padStart(3,'0')+' '+event.text).join('\n'):'No voice events.';
}

function findTarget(lab,router,number,active) {
  const cfg=router.cme,seen=new Set(),hops=[];
  while(!seen.has(number)&&seen.size<10){
    seen.add(number);
    const defined=Object.values(cfg.dns).filter(line=>matches(line,number));
    if(!defined.length)return {reason:'Unallocated extension '+number+'.',hops};
    const candidates=lab.devices.filter(d=>d.type==='phone').flatMap(phone=>{
      const status=registrationStatus(lab,phone,router);
      return status.ok?phoneLines(cfg,status.record).filter(entry=>matches(entry.line,number)).map(({line})=>({phone,line,status})):[];
    });
    const all=defined.find(line=>line.forwardAll)?.forwardAll;
    if(all){
      hops.push(number+' forwarded to '+all);
      number=all;continue;
    }
    if(!candidates.length)return {reason:'Extension '+number+' has no registered phone.',hops};
    const available=candidates.find(({phone})=>!phone.host.call&&!active.some(row=>party(row,phone)));
    if(available)return {...available,hops,number};
    const busy=candidates.find(({line})=>line.forwardBusy)?.line.forwardBusy;
    if(!busy)return {reason:'Extension '+number+' is busy.',target:candidates[0].phone,hops};
    hops.push(number+' forwarded on busy to '+busy);
    number=busy;
  }
  return {reason:'Call forwarding loop detected.',hops};
}

function dial(lab,router,phone,number) {
  const status=registrationStatus(lab,phone,router);
  const local=status.ok&&phoneLines(router.cme,status.record)[0]?.line;
  const fail=(reason,target,hops=[])=>{
    const failure='Call failed · '+reason;
    if(router){
      const call=record(router,phone,number,local,target);
      for(const hop of hops)event(lab,router,call,hop);
      finish(lab,router,call,'FAILED',reason);
    }else phoneLocalEvent(phone,failure);
    return reply(failure,status.path);
  };
  if(!status.ok)return fail(status.reason);
  if(!local)return fail('This phone has no assigned line.');
  const active=refreshCalls(lab,router);
  if(phone.host.call||active.some(row=>party(row,phone)))return fail('This phone already has a call.');
  const target=findTarget(lab,router,number,active);
  if(target.reason)return fail(target.reason,target.target,target.hops);
  if(target.phone===phone)return fail('The destination is this phone.',phone,target.hops);
  const call=record(router,phone,number,local,target.phone);
  call.connectedTo=target.number;
  call.state='RINGING';call.detail=target.phone.name+' is ringing.';
  event(lab,router,call,'Dialed '+number+' from '+phone.name);
  for(const hop of target.hops)event(lab,router,call,hop);
  event(lab,router,call,'RINGING · '+call.detail);
  const path=[...status.path,...target.status.path.slice(0,-1).reverse()];
  return reply(`Call ${call.id} · ${call.detail}\nRingback on ${phone.name}. Run answer on ${target.phone.name}.`,path);
}

export function cmeCallCommand(lab,phone,verb,number) {
  const router=cmeRouter(lab,phone);
  if(verb==='dial'){
    if(!/^\d{1,16}$/.test(number))return invalid('Dial an extension containing 1–16 digits.');
    return dial(lab,router,phone,number);
  }
  const call=refreshCalls(lab,router).find(row=>party(row,phone));
  if(!call)return reply('No active SCCP call.');
  if(verb==='hangup'){
    finish(lab,router,call,'DISCONNECTED',phone.name+' hung up.');
    return reply(`Call ${call.id} ended.`);
  }
  if(call.callee!==phone.id||call.state!=='RINGING')return reply('No incoming call to '+verb+'.');
  if(verb==='reject'){
    finish(lab,router,call,'REJECTED',phone.name+' declined the call.');
    return reply(`Call ${call.id} rejected.`);
  }
  const caller=deviceById(lab,call.caller);
  const media=mediaPath(lab,caller,phone,true);
  if(!media.ok){
    const reason='RTP media is unreachable. '+media.reason;
    finish(lab,router,call,'FAILED',reason);
    return reply('Call failed · '+reason,media.path);
  }
  call.state='CONNECTED';call.detail='Two-way RTP path verified (simulated).';
  event(lab,router,call,'ANSWERED by '+phone.name+' · CONNECTED · '+call.detail);
  return reply(`Call ${call.id} connected: ${call.from} -> ${call.to}\n`+call.detail,media.path);
}
