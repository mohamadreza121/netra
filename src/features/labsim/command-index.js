import { commandReference as ccnaReference } from '../ccna/catalog.mjs';
import { labelMode } from '../ccnp/lesson.mjs';
import { makeLivePracticeSession } from '../ccnp/live-session.mjs';
import { labs as ccnpLabs } from '../ccnp/catalog.mjs';
import { addDevice, emptyLab } from './network.js';
import { execute, terminalSession } from './cli.js';

const types=[
  [/^SW\d/i,'switch'],[/^(?:R|ISP|PE|CE)\d/i,'router'],[/^WLC/i,'wlc'],[/^AP\d/i,'ap'],
  [/^PC\d/i,'pc'],[/^(?:SRV|SERVER)\d/i,'server'],[/^ISE/i,'ise'],[/^(?:TEL|PHONE)\d/i,'phone']
];
const titles={user:'User EXEC',exec:'Privileged EXEC',global:'Global configuration',host:'Host shell'};
const typeOf=name=>types.find(([pattern])=>pattern.test(name))?.[1];

function describe(entry,ccna,contexts) {
  if(!ccna)return {level:entry.mode.level,path:entry.mode.path,label:labelMode(entry.mode)};
  const mode=entry.mode,label=titles[mode]??mode;
  if(mode==='host'||mode==='user'||mode==='exec')return {level:mode,path:[],label};
  return {level:'config',path:mode==='global'?[]:contexts.get(mode)??[mode],label};
}

function probe(lab,node,entry,mode) {
  if(!node||['tcl','rommon'].includes(mode.level))return false;
  const session=terminalSession(node);
  if(session.mode!=='endpoint'){
    if(mode.level==='host')return false;
    if(mode.level==='exec')session.mode='exec';
    if(mode.level==='config'){
      session.mode='global';
      for(const context of mode.path){
        if(execute(lab,node,session,context).text.startsWith('%'))return false;
      }
    }
  }
  const result=execute(lab,node,session,entry.command);
  return !result.text.startsWith('%');
}

export function buildCommandIndex() {
  const byLab=new Map();
  for(const entry of ccnaReference){
    const rows=byLab.get(entry.lab)??[];
    rows.push(entry);byLab.set(entry.lab,rows);
  }
  for(const lab of ccnpLabs)byLab.set(lab,lab.steps);
  const examples=[];
  for(const [lesson,steps] of byLab){
    const ccna=!lesson.topics,tracks=ccna?['ccna']:Object.keys(lesson.topics).filter(key=>lesson.topics[key].length);
    const guidedVoice=lesson.buildWorkspace?makeLivePracticeSession(lesson):null;
    const deviceSet=new Map(),contextSet=new Map(),workspace=emptyLab();
    for(const device of lesson.devices){
      const type=typeOf(device);
      if(type&&!guidedVoice)deviceSet.set(device,addDevice(workspace,type));
      if(ccna)contextSet.set(device,new Map());
    }
    for(const entry of steps){
      const contexts=contextSet.get(entry.device);
      const mode=describe(entry,ccna,contexts);
      const type=typeOf(entry.device)??null;
      let labSim=false;
      try{labSim=guidedVoice?guidedVoice.run(entry.device,entry.command).ok:probe(workspace,deviceSet.get(entry.device),entry,mode);}catch{
        // CLI inputs can depend on unmodeled hardware, cable state or examples outside this device model.
        // Every example still has a directly addressable guided console.
      }
      if(contexts&&mode.level==='config'){
        const key=entry.command.toLowerCase();
        const path=key.startsWith('class ')&&mode.path[0]?.toLowerCase().startsWith('policy-map ')?
          [...mode.path,entry.command]:[entry.command];
        contexts.set(key,path);
      }
      examples.push({
        command:entry.command,explanation:entry.explanation,mode:mode.label,device:entry.device,type,
        lesson:lesson.id,title:lesson.title,index:entry.index,tracks,labSim
      });
    }
  }
  return examples;
}
