import { addDevice, addLink, branchLab, deviceById, deviceLimit, emptyLab, endpoint, gateway, hostIp, hostPrefix, isHost, linkUp, models, peer, removeDevice, restoreLab, voiceVlan, wifiUp } from './network.js';
import { commandHelp, commandSets, execute, prompt, syntax, terminalSession } from './cli.js';
import { guidedEntries, guidedTopics } from './reference.js';

const $=id=>document.getElementById(id);
const board=$('sim-board');
const canvas=$('sim-lines');
const input=$('sim-command');
const output=$('sim-output');
const cableSelects=[$('sim-a'),$('sim-b')];
const portSelects=[$('sim-a-port'),$('sim-b-port')];
const confirmDialog=$('sim-confirm');
const saveKey='netra.labsim.v1';
const sessions=new Map();
const histories=new Map();
const recentCommands=new Map();
let commandIndex;
const palette={ up:'#7ce5b6',down:'#788983',wifi:'#9abef0',traffic:'#e7ff83' };
let lab;
let saved=true;
let selected;
let traffic=[];
let pendingAction;
let drag;

try {
  const stored=localStorage.getItem(saveKey);
  lab=stored?restoreLab(stored):branchLab();
} catch {
  lab=branchLab();
  saved=false;
}
selected=lab.devices.find(d=>d.type==='pc')?.id??lab.devices[0]?.id;

function element(tag,text,className) {
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
}
function button(text,action,className='sim-button') {
  const control=element('button',text,className);
  control.type='button';control.addEventListener('click',action);
  return control;
}
function active(){return deviceById(lab,selected);}
function say(message){$('sim-status').textContent=message;}
function save() {
  try {localStorage.setItem(saveKey,JSON.stringify(lab));saved=true;}
  catch {saved=false;}
  $('sim-save').textContent=saved?'Saved in this browser':'Browser save unavailable';
}

function draw() {
  const width=board.clientWidth, height=board.clientHeight;
  const ratio=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  }
  const pen=canvas.getContext('2d');
  if(!pen)return;
  pen.setTransform(ratio,0,0,ratio,0,0);
  pen.clearRect(0,0,width,height);
  function line(a,b,kind){
    const hot=traffic.some((id,i)=>(id===a.id&&traffic[i+1]===b.id)||(id===b.id&&traffic[i+1]===a.id));
    pen.strokeStyle=hot?palette.traffic:palette[kind];
    pen.lineWidth=hot?3:1.8;
    pen.setLineDash(kind==='wifi'?[5,5]:kind==='down'?[3,5]:[]);
    pen.beginPath();
    pen.moveTo(a.x*width/100,a.y*height/100);
    pen.lineTo(b.x*width/100,b.y*height/100);
    pen.stroke();
  }
  for(const {a,b} of lab.links) {
    const left=deviceById(lab,a.device),right=deviceById(lab,b.device);
    line(left,right,linkUp(lab,left,a.port)?'up':'down');
  }
  for(const host of lab.devices.filter(isHost)){
    const ap=wifiUp(lab,host);
    if(ap)line(host,ap,'wifi');
  }
}

function place(node,d) {
  node.style.left=d.x+'%';
  node.style.top=d.y+'%';
}
function renderBoard() {
  $('sim-board-empty').hidden=lab.devices.length!==0;
  $('sim-nodes').replaceChildren(...lab.devices.map(d=>{
    const node=button(undefined,()=>{
      if(drag?.moved)return;
      select(d.id);
    },'sim-node');
    node.dataset.id=d.id;node.dataset.type=d.type;
    node.setAttribute('aria-label',d.name+' '+models[d.type].title);
    const icon=element('span',undefined,'sim-node-icon');
    icon.dataset.icon=models[d.type].icon;
    icon.setAttribute('aria-hidden','true');
    node.append(icon,element('b',d.name));
    place(node,d);
    node.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      drag={id:d.id,x:event.clientX,y:event.clientY,startX:d.x,startY:d.y,moved:false};
    });
    node.addEventListener('pointermove',event=>{
      if(drag?.id!==d.id)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      if(!drag.moved)node.setPointerCapture(event.pointerId);
      drag.moved=true;
      d.x=Math.min(94,Math.max(6,drag.startX+dx/board.clientWidth*100));
      d.y=Math.min(94,Math.max(6,drag.startY+dy/board.clientHeight*100));
      place(node,d);
      draw();
    });
    node.addEventListener('pointerup',()=>{
      if(drag?.moved){
        save();
        setTimeout(()=>{drag=null;},0);
      } else drag=null;
    });
    node.addEventListener('pointercancel',()=>{if(drag?.moved)save();drag=null;});
    return node;
  }));
  draw();
}

function optionList(select,options,empty) {
  const last=select.value;
  select.replaceChildren(...options.map(([value,label])=>new Option(label,value)));
  if(options.some(([value])=>value===last))select.value=last;
  if(!options.length)select.append(new Option(empty,''));
}
function portsFor(index) {
  const device=deviceById(lab,cableSelects[index].value);
  const options=device?models[device.type].ports.map(name=>[name,name+(peer(lab,device,name)?' · connected':'')]):[];
  const control=portSelects[index];
  optionList(control,options,'Choose a device');
  if(device&&control.dataset.device!==device.id) {
    const available=options.find(([name])=>!peer(lab,device,name));
    if(available)control.value=available[0];
  }
  control.dataset.device=device?.id??'';
}
function renderCables() {
  const choices=lab.devices.map(d=>[d.id,d.name+' · '+models[d.type].title]);
  for(let i=0;i<2;i++){
    optionList(cableSelects[i],choices,'Add a device');
    if(i===1&&choices.length>1&&cableSelects[0].value===cableSelects[1].value){
      cableSelects[1].value=choices.find(([id])=>id!==cableSelects[0].value)[0];
    }
    portsFor(i);
  }
  $('sim-cables').querySelector('button').disabled=lab.devices.length<2;
  $('sim-links').replaceChildren(...lab.links.map(({a,b},i)=>{
    const d=deviceById(lab,a.device),e=deviceById(lab,b.device);
    const row=element('li');
    const label=element('span',`${d.name} ${a.port} ↔ ${e.name} ${b.port}`);
    label.dataset.up=String(linkUp(lab,d,a.port));
    const remove=button('Disconnect',()=>{
      lab.links.splice(i,1);traffic=[];refresh();save();say('Cable disconnected.');
    });
    remove.setAttribute('aria-label','Disconnect '+label.textContent);
    row.append(label,remove);
    return row;
  }));
}

function setConsole(showHistory=false) {
  const d=active();
  $('sim-console-title').textContent=d?d.name+' console':'Device console';
  $('sim-prompt').textContent=d?prompt(d,sessions.get(d.id)):'›';
  input.disabled=!d;
  input.nextElementSibling.disabled=!d;
  $('sim-clear').disabled=!d;
  if(showHistory){
    output.textContent=d?(histories.get(d.id)?.join('\n')||'Type ? for available commands.'):'Select a device on the topology.';
    output.scrollTop=output.scrollHeight;
  }
}

function renderInspector() {
  const d=active();
  $('sim-inspector-title').textContent=d?d.name+' · '+models[d.type].title:'Device';
  $('sim-remove').disabled=!d;
  const items=[];
  if(d){
    if(isHost(d)) {
      items.push(['IPv4',hostIp(d)?hostIp(d)+'/'+hostPrefix(d):'Unassigned'],['Gateway',gateway(d)??'—']);
      const ap=wifiUp(lab,d);
      if(ap)items.push(['Wi-Fi',ap.radio.ssid+' · '+ap.name]);
      if(d.type==='phone')items.push(['Extension',d.host.extension??'Unassigned'],['Voice VLAN',voiceVlan(lab,d)??'—']);
    }
    if(d.type==='ap')items.push(['Radio',d.radio.enabled?'On · '+d.radio.ssid:'Off'],['IPv4',hostIp(d)?hostIp(d)+'/'+hostPrefix(d):'Unassigned']);
    for(const [name,p] of Object.entries(d.ports)){
      const far=peer(lab,d,name);
      const attributes=d.type==='switch'?(p.mode==='trunk'?'trunk · native '+p.native:'VLAN '+p.vlan+(p.voice?' · voice '+p.voice:'')):
        p.address?p.address+'/'+p.prefix:'';
      items.push([name,[linkUp(lab,d,name)?'Up':p.up?'Down':'Shut',attributes,far?deviceById(lab,far.device).name+' '+far.port:''].filter(Boolean).join(' · ')]);
    }
  } else items.push(['Topology','Select a device.']);
  $('sim-inspector').replaceChildren(...items.flatMap(([title,value])=>[element('dt',title),element('dd',value)]));
}

const modeLabels={user:'User EXEC',exec:'Privileged EXEC',global:'Global configuration',interface:'Interface',range:'Interface range',vlan:'VLAN configuration',pool:'DHCP pool',ospf:'OSPF process',acl:'Access list',endpoint:'Device console'};
function renderReference() {
  const d=active();
  const target=$('sim-commands');
  target.replaceChildren();
  if(!d){target.append(element('p','Select a device.'));return;}
  const query=$('sim-command-search').value.trim().toLowerCase();
  const matches=text=>text.toLowerCase().includes(query);
  function group(title,entries){
    if (!entries.length)return;
    const details=element('details');
    details.open=Boolean(query)||title===modeLabels[sessions.get(d.id).mode]||title==='Quick examples';
    details.append(element('summary',title));
    for(const entry of entries)details.append(entry);
    target.append(details);
  }
  if($('sim-command-scope').value==='live'){
    const sections=[...(d.type==='router'||d.type==='switch'?syntax.ios:[]),...syntax[d.type]];
    group('Quick examples',sections.filter(([title,cmd])=>matches(title+' '+cmd)).map(([title,cmd,note])=>{
      const row=element('div',undefined,'sim-ref-entry');
      row.append(element('h3',title),element('code',cmd),element('p',note));
      return row;
    }));
    for(const [mode,patterns] of Object.entries(commandSets[d.type])){
      group(modeLabels[mode],[...new Set(patterns)].filter(pattern=>matches(pattern)||matches(modeLabels[mode])).map(pattern=>element('code',pattern,'sim-ref-command')));
    }
  } else {
    const intro=element('p','Use this syntax in CCNA Practice when a guided lab is available.');
    const link=element('a','Open CCNA Practice command reference');link.href='/ccna/#reference';
    target.append(intro,link);
    group('Topics by volume',guidedTopics.filter(topic=>topic.types.includes(d.type)&&matches(topic.title+' '+topic.terms)).map(topic=>{
      const row=element('div',undefined,'sim-ref-entry');
      row.append(element('h3',topic.title),element('p',topic.source),element('code',topic.terms));
      return row;
    }));
    group('Guided CLI examples',guidedEntries(d.type).filter(entry=>matches(entry.command+' '+entry.lab.title)).map(entry=>{
      const row=element('div',undefined,'sim-ref-entry');
      row.append(element('code',entry.command),element('p',entry.lab.title));
      return row;
    }));
  }
  if(!target.querySelector('details'))target.append(element('p','No matching commands.'));
}

$('sim-command-search').addEventListener('input',renderReference);
$('sim-command-scope').addEventListener('change',renderReference);
function logConsole(d,line,result) {
  const log=histories.get(d.id)??[];
  log.push(line,...(result?[result]:[]));
  histories.set(d.id,log.slice(-180));
}
function showHelp(d) {
  const session=sessions.get(d.id);
  const result=commandHelp(d,session,input.value);
  logConsole(d,prompt(d,session)+' '+input.value+'?',result.text);
  setConsole(true);
}

function select(id) {
  selected=id;
  const d=active();
  if(d&&!sessions.has(id))sessions.set(id,terminalSession(d));
  for(const item of $('sim-nodes').children)item.setAttribute('aria-pressed',String(item.dataset.id===id));
  renderInspector();
  renderReference();
  input.value='';
  commandIndex=undefined;
  setConsole(true);
}

function renderCapacity(){
  $('sim-count').textContent=lab.devices.length+' / 50 devices';
  for(const control of $('sim-add').children){
    const total=lab.devices.filter(d=>d.type===control.dataset.type).length;
    control.disabled=total>=deviceLimit;
    control.lastElementChild.textContent=total+'/'+deviceLimit;
  }
}
function refresh() {renderBoard();renderCables();renderCapacity();select(selected);}

cableSelects.forEach((control,i)=>control.addEventListener('change',()=>portsFor(i)));
$('sim-cables').addEventListener('submit',event=>{
  event.preventDefault();
  try{
    const a=deviceById(lab,cableSelects[0].value),b=deviceById(lab,cableSelects[1].value);
    if(!a||!b)throw Error('Choose two devices.');
    addLink(lab,endpoint(a,portSelects[0].value),endpoint(b,portSelects[1].value));
    traffic=[];refresh();save();say('Ethernet cable connected.');
  }catch(error){say(error.message);}
});
for(const [type,model] of Object.entries(models)){
  const control=button('+ '+model.title,()=>{
    try {
      selected=addDevice(lab,type).id;
      refresh();save();say(active().name+' added.');
    } catch(error){say(error.message);}
  });
  control.dataset.type=type;
  control.append(element('small'));
  $('sim-add').append(control);
}
input.addEventListener('keydown',event=>{
  const d=active();
  if(!d)return;
  if(event.key==='?'&&input.selectionStart===input.value.length&&input.value.split('"').length%2===1&&input.value.split("'").length%2===1){
    event.preventDefault();showHelp(d);return;
  }
  if(event.key==='Tab'&&!event.shiftKey&&input.selectionStart===input.value.length){
    const help=commandHelp(d,sessions.get(d.id),input.value);
    if(help.completed){
      event.preventDefault();input.value=help.completed;return;
    }
  }
  if(!['ArrowUp','ArrowDown'].includes(event.key))return;
  const commands=recentCommands.get(selected);
  if(!commands?.length)return;
  event.preventDefault();
  commandIndex=Math.max(0,Math.min(commands.length,(commandIndex??commands.length)+(event.key==='ArrowUp'?-1:1)));
  input.value=commands[commandIndex]??'';
});
$('sim-console').addEventListener('submit',event=>{
  event.preventDefault();
  const d=active();
  const command=input.value;
  if(!d||!command.trim())return;
  const s=sessions.get(d.id);
  const before=prompt(d,s);
  const commands=recentCommands.get(d.id)??[];
  if(commands.at(-1)!==command)recentCommands.set(d.id,[...commands.slice(-39),command]);
  commandIndex=undefined;
  const result=execute(lab,d,s,command);
  logConsole(d,before+' '+command,result.text);
  traffic=result.path??[];
  save();
  renderInspector();
  renderCables();
  for(const item of $('sim-nodes').children){
    const itemDevice=deviceById(lab,item.dataset.id);
    item.querySelector('b').textContent=itemDevice.name;
    item.setAttribute('aria-label',itemDevice.name+' '+models[itemDevice.type].title);
  }
  draw();
  setConsole(true);
  input.value='';
  input.focus({preventScroll:true});
});
$('sim-clear').addEventListener('click',()=>{histories.delete(selected);setConsole(true);});

function requestChange(title,message,action){
  $('sim-confirm-title').textContent=title;
  $('sim-confirm-copy').textContent=message;
  pendingAction=action;
  confirmDialog.returnValue='';
  confirmDialog.showModal();
}
confirmDialog.addEventListener('close',()=>{
  if(confirmDialog.returnValue==='confirm')pendingAction?.();
  pendingAction=undefined;
});
function replace(next){
  lab=next;traffic=[];histories.clear();sessions.clear();recentCommands.clear();
  selected=lab.devices.find(d=>d.type==='pc')?.id??lab.devices[0]?.id;
  refresh();save();say(lab.devices.length?'Branch LAN loaded.':'Empty lab created.');
}
$('sim-starter').addEventListener('click',()=>requestChange('Load Branch LAN?','This replaces the current browser workspace. You can export it first.',()=>replace(branchLab())));
$('sim-empty').addEventListener('click',()=>requestChange('Create an empty lab?','This replaces the current browser workspace. You can export it first.',()=>replace(emptyLab())));
$('sim-remove').addEventListener('click',()=>{
  const d=active();
  if(!d)return;
  requestChange('Remove '+d.name+'?','Its device configuration and cables will be removed.',()=>{
    removeDevice(lab,d.id);sessions.delete(d.id);histories.delete(d.id);recentCommands.delete(d.id);traffic=[];selected=lab.devices[0]?.id;
    refresh();save();say(d.name+' removed.');
  });
});
$('sim-export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(lab,null,2)],{type:'application/json'}));
  const anchor=element('a');
  anchor.href=url;anchor.download='netra-lab.json';
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  say('Lab JSON exported.');
});
new ResizeObserver(draw).observe(board);
refresh();
if(saved)save();
else $('sim-save').textContent='Recovered with Branch LAN';
