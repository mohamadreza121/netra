import { commandHelp, execute, prompt, terminalSession } from '../labsim/cli.js';
import { grammars } from '../labsim/commands.js';
import { resolve } from '../labsim/grammar.js';
import { interfaceName } from '../labsim/ios.js';

const configModes={
  interface:['interface',value=>interfaceName([value])],
  vlan:['vlan',Number],
  'ip dhcp pool':['pool',value=>value.toUpperCase()],
  'telephony-service':['telephony',()=>undefined],
  'ephone-dn':['ephoneDn',Number],
  ephone:['ephone',Number]
};

function matchesMode(session,mode) {
  if(mode.level==='host')return session.mode==='endpoint';
  if(mode.level!=='config')return session.mode===mode.level;
  if(!mode.path.length)return session.mode==='global';
  const command=mode.path.at(-1);
  for(const [prefix,[name,parse]] of Object.entries(configModes)){
    if(command===prefix||command.startsWith(prefix+' ')){
      if(session.mode!==name)return false;
      return prefix==='telephony-service'||session.current===parse(command.split(' ')[prefix.split(' ').length]);
    }
  }
  return false;
}

function sameCommand(device,session,input,sample) {
  const patterns=grammars[device.type][session.mode];
  const actual=resolve(patterns,input).args,expected=resolve(patterns,sample).args;
  if(!actual||!expected||actual.length!==expected.length)return false;
  return actual.every((word,i)=>word.toLowerCase()===expected[i].toLowerCase()||
    Boolean(interfaceName([word])&&interfaceName([word])===interfaceName([expected[i]])));
}

export function makeLivePracticeSession(lesson) {
  const lab=lesson.buildWorkspace();
  const consoles=new Map(lab.devices.map(device=>[device.name,{device,session:terminalSession(device)}]));
  let cursor=0;
  return {
    steps:lesson.steps,
    state:lab,
    get cursor(){return cursor;},
    run(name,input){
      const client=consoles.get(name);
      if(!client)return {ok:false,output:'% Choose a device in this scenario.'};
      const {device,session}=client,step=lesson.steps[cursor];
      const advances=step?.device===name&&matchesMode(session,step.mode)&&sameCommand(device,session,input,step.command);
      const result=execute(lab,device,session,input);
      const ok=Boolean(input.trim())&&!result.text.startsWith('%');
      if(ok&&advances)cursor++;
      return {ok,output:result.text};
    },
    prompt(name){
      const {device,session}=consoles.get(name);
      return prompt(device,session,lab);
    },
    help(name,input){
      const {device,session}=consoles.get(name);
      return commandHelp(device,session,input,lab);
    }
  };
}
