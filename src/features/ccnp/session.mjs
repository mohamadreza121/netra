import { addressOf, labelMode, modeFor, scope } from './lesson.mjs';
import { makeLivePracticeSession } from './live-session.mjs';
import { tokens } from '../labsim/grammar.js';

const generic = {
  user:['enable'],
  exec:['configure terminal','disable','show running-config','show startup-config','copy running-config startup-config','write memory','show history','terminal length 0'],
  config:['exit','end']
};
const cached = new WeakMap();
const tokenize = command => tokens(command).map(token=>token.raw);
const commandKey = command => tokenize(command).map(word=>word.startsWith('"')||word.startsWith("'")?word:word.toLowerCase()).join(' ');
const interfacePrefix = (sample, input) => {
  const form=/^(gigabitethernet|tengigabitethernet|fastethernet|port-channel|loopback|tunnel|vlan|nve)([\d/.]+)$/i.exec(sample);
  const partial=/^([a-z-]+)([\d/.]+)$/i.exec(input);
  return Boolean(form&&partial&&form[1].toLowerCase().startsWith(partial[1].toLowerCase())&&form[2]===partial[2]);
};
const success = (output = '') => ({ok:true,output});
const fail = message => ({ok:false,output:'% '+message});

// IOS command words in the examples are lower case. Addresses, numbers, named
// lab objects and quoted arguments must match their example rather than expand.
function dictionary(lines) {
  return [...new Set(lines)].map(line=>tokenize(line));
}

function walk(rows, words, exactShell=false) {
  const resolved=[];
  let active=rows;
  for(const word of words) {
    const key=exactShell||word.startsWith('"')||word.startsWith("'")?word:word.toLowerCase();
    const at=resolved.length;
    const expected=[...new Set(active.map(row=>row[at]).filter(Boolean))];
    const fold=token=>exactShell||token.startsWith('"')||token.startsWith("'")?token:token.toLowerCase();
    const exact=expected.find(token=>fold(token)===key);
    const partial=(!exact&&!exactShell?expected.filter(token=>(/^[a-z][a-z0-9-]*$/.test(token)&&token.startsWith(key))||interfacePrefix(token,word)):[]);
    if(partial.length>1) return {error:'Ambiguous command. Matches: '+partial.sort().join(', ')};
    const match=exact??partial[0];
    if(!match) return {error:'Command unavailable in this scenario or CLI mode. Type ? for supported examples.'};
    resolved.push(match);
    active=active.filter(row=>row[at]===match);
  }
  return {active,resolved};
}

function getIndex(lab) {
  if(cached.has(lab))return cached.get(lab);
  const index=new Map();
  for(const step of lab.steps) {
    const id=step.device+'@'+addressOf(step.mode);
    if(!index.has(id)) index.set(id,[]);
    index.get(id).push(step);
  }
  cached.set(lab,index);
  return index;
}

export function makeCCNPSession(lab) {
  if(lab.buildWorkspace)return makeLivePracticeSession(lab);
  const steps=lab.steps;
  const index=getIndex(lab);
  const modes={...lab.initialModes};
  const state=structuredClone(lab.initial??{});
  const configuration=new Map(lab.devices.map(name=>[name,new Map()]));
  const histories=new Map();
  const startup=new Map();
  let cursor=0;

  function entries(device,mode=modes[device]) {return index.get(device+'@'+addressOf(mode))??[];}
  function possible(device,mode=modes[device]) {
    const examples=entries(device,mode).map(step=>step.command);
    const commands=generic[mode.level]??[];
    if(mode.level==='config') {
      const leave=modeFor(mode.path.at(-1)??'')?.[2];
      return dictionary([...examples,...commands,...(leave?[leave]:[]),'do show running-config','do show startup-config',...entries(device,scope('exec'))
        .filter(step=>step.command.startsWith('show ')).map(step=>'do '+step.command)]);
    }
    return dictionary([...examples,...commands]);
  }

  function record(device,mode,command,key) {
    const deviceCfg=configuration.get(device);
    const id=addressOf(mode);
    if(!deviceCfg.has(id)) deviceCfg.set(id,{path:mode.path,lines:new Map()});
    const lines=deviceCfg.get(id).lines;
    if(command.startsWith('no ')&&!key&&lines.has(commandKey(command.slice(3)))) lines.delete(commandKey(command.slice(3)));
    else lines.set(key??commandKey(command),command);
  }

  function running(device) {
    const root={lines:[],children:new Map()};
    for(const {path,lines} of configuration.get(device).values()) {
      let parent=root;
      for(const context of path) {
        if(!parent.children.has(context)) parent.children.set(context,{lines:[],children:new Map()});
        parent=parent.children.get(context);
      }
      parent.lines.push(...lines.values());
    }
    const format = (entry, depth) => [
      ...entry.lines.map(line=>' '.repeat(depth)+line),
      ...[...entry.children].flatMap(([heading,node])=>[' '.repeat(depth)+heading,...format(node,depth+1)])
    ];
    return format(root,0).join('\n') || '(no changes in this scenario)';
  }

  function help(device, partial, full = false) {
    const mode=modes[device];
    const exactShell=['host','rommon','tcl'].includes(mode.level);
    const trailing=/\s$/.test(partial);
    const words=tokenize(partial);
    const last=trailing?'':words.pop()??'';
    const result=walk(possible(device),words,exactShell);
    if(result.error)return {text:'% '+result.error};
    if(full&&!words.length&&!last)return {text:result.active.map(row=>row.join(' ')).sort().join('\n')||'Select the device shown in the guide.'};
    const choices=[...new Set(result.active.map(row=>row[words.length]??'<cr>'))].filter(word=>(exactShell?word:word.toLowerCase()).startsWith(exactShell?last:last.toLowerCase())).sort();
    const completion=last&&choices.filter(word=>word!=='<cr>').length===1?partial.slice(0,partial.lastIndexOf(last))+choices[0]+' ':undefined;
    return {text:choices.join('\n')||'% No matching keywords.',completed:completion};
  }

  function navigation(device,command,mode,step) {
    if(step?.nextMode) {
      if(step.nextMode.level==='config'&&step.nextMode.path.length>mode.path.length&&step.nextMode.path.at(-1)===command) {
        const path=step.nextMode.path;
        const id=addressOf(step.nextMode);
        const deviceCfg=configuration.get(device);
        if(!deviceCfg.has(id))deviceCfg.set(id,{path,lines:new Map()});
      }
      modes[device]=step.nextMode;
      return success(command==='configure terminal'?'Enter configuration commands. End with CNTL/Z.':'');
    }
    if(command==='enable'&&mode.level==='user') {modes[device]=scope('exec');return success();}
    if(command==='disable'&&mode.level==='exec') {modes[device]=scope('user');return success();}
    if(command==='configure terminal'&&mode.level==='exec') {modes[device]=scope('config');return success('Enter configuration commands. End with CNTL/Z.');}
    if(mode.level==='config'&&['end','exit',modeFor(mode.path.at(-1)??'')?.[2]].includes(command)) {
      modes[device]=command==='end'||!mode.path.length?scope('exec'):scope('config',mode.path.slice(0,-1));
      return success();
    }
    return null;
  }

  function run(device,input) {
    const line=input.trim();
    const mode=modes[device];
    if(!mode)return fail('Choose a device in this scenario.');
    if(!line) return {ok:false,output:''};
    if(line==='help') return success(help(device,'',true).text);
    if(line.endsWith('?')&&line.split('"').length%2===1&&line.split("'").length%2===1) return success(help(device,input.slice(0,input.lastIndexOf('?')),line==='?').text);
    const exactShell=['host','rommon','tcl'].includes(mode.level);
    const match=walk(possible(device),tokenize(line),exactShell);
    if(match.error)return fail(match.error);
    if(!match.active.some(row=>row.length===match.resolved.length))return fail('Incomplete command. Type a space followed by ? for the next argument.');
    const canonical=match.resolved.join(' ');
    const command=commandKey(canonical);
    const isDo=mode.level==='config'&&command.startsWith('do ');
    const lookup=isDo?scope('exec'):mode;
    const actual=isDo?command.slice(3):command;
    const expected=steps[cursor];
    const equal=step=>step?.device===device&&addressOf(step.mode)===addressOf(lookup)&&commandKey(step.command)===actual;
    const isExpected=!isDo&&equal(expected);
    const direct=isExpected?expected:entries(device,lookup).find(equal);
    const history=histories.get(device)??[];
    histories.set(device,[...history.slice(-39),line]);
    let result=navigation(device,canonical,mode,direct);
    if(!result) {
      if(actual==='show running-config'&&lookup.level==='exec')result=success(running(device));
      else if(actual==='show startup-config'&&lookup.level==='exec')result=success(startup.get(device)??'startup-config is not present');
      else if(actual==='show history'&&lookup.level==='exec')result=success(histories.get(device).join('\n'));
      else if(['copy running-config startup-config','write memory'].includes(actual)&&lookup.level==='exec') {
        startup.set(device,running(device));result=success('Building configuration...\n[OK]');
      } else if(actual==='terminal length 0'&&lookup.level==='exec') result=success();
      else if(direct){
        direct.apply?.(state,device);
        if(mode.level==='config'&&!isDo) record(device,mode,direct.command,direct.configKey);
        result=success(direct.output?.(state,device)??'');
      } else result=fail('Command unavailable in this scenario.');
    }
    if(result.ok&&isExpected) cursor++;
    return result;
  }

  function prompt(device) {
    const mode=modes[device];
    if(mode.level==='host')return device+'$';
    if(mode.level==='rommon')return 'rommon >';
    if(mode.level==='tcl')return device+'(tcl)#';
    if(mode.level==='user')return device+'>';
    if(mode.level==='exec')return device+'#';
    const suffix=modeFor(mode.path.at(-1)??'')?.[1]??'config';
    return device+'('+suffix+')#';
  }
  return {state,steps,run,prompt,help,config:running,get cursor(){return cursor;}};
}

export function openCCNPStep(lab,index=0) {
  const session=makeCCNPSession(lab);
  for(const step of lab.steps.slice(0,index)) {
    const result=session.run(step.device,step.command);
    if(!result.ok||session.cursor!==step.index+1) throw Error('Could not prepare '+lab.id+' at step '+(step.index+1)+' ('+labelMode(step.mode)+').');
  }
  return session;
}
