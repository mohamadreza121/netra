import { deviceById, linkUp, models, peer } from './network.js';
import { bundle, bridgeState, memberPorts } from './switching.js';
import { interfaceName, vlanIds } from './ios.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const stpTimers=['hello-time <seconds>','max-age <seconds>','forward-time <seconds>'];
const lagHashes=['src-mac','dst-mac','src-dst-mac','src-ip','dst-ip','src-dst-ip'];
export const campusIOS={
  operational:['show dtp interface [<interface...>]','show vtp status','show vtp counters','show vtp password','show vtp devices',
    'show etherchannel <id> detail','show etherchannel load-balance','show lacp neighbor','show pagp neighbor',
    'show spanning-tree mst [<instance>]','show spanning-tree mst configuration [digest]',
    'show spanning-tree mst [<instance>] interface <interface...>','show spanning-tree interface <interface> [detail]',
    'show spanning-tree inconsistentports','show spanning-tree uplinkfast','show errdisable recovery','show udld interface <interface...>',
    'show interfaces status err-disabled'],
  global:['vtp domain <name>','vtp mode server','vtp mode client','vtp mode transparent','vtp mode off',
    'vtp version <version>','vtp password <value>','no vtp password','vtp pruning','no vtp pruning',
    'spanning-tree mst configuration','spanning-tree mst <instance> root primary','spanning-tree mst <instance> root secondary',
    'spanning-tree mst <instance> priority <priority>',...stpTimers.map(timer=>'spanning-tree vlan <vlan> '+timer),
    'spanning-tree uplinkfast','no spanning-tree uplinkfast','spanning-tree backbonefast','no spanning-tree backbonefast',
    'lacp system-priority <priority>',...lagHashes.map(hash=>'port-channel load-balance '+hash),
    'errdisable recovery cause bpduguard','no errdisable recovery cause bpduguard','errdisable recovery cause udld',
    'no errdisable recovery cause udld','errdisable recovery cause psecure-violation','no errdisable recovery cause psecure-violation',
    'errdisable recovery interval <seconds>'],
  interface:['switchport mode dynamic auto','switchport mode dynamic desirable','switchport trunk encapsulation dot1q',
    'spanning-tree guard root','spanning-tree guard loop','spanning-tree guard none',
    'spanning-tree bpdufilter enable','spanning-tree bpdufilter disable','spanning-tree link-type point-to-point','spanning-tree link-type shared',
    'spanning-tree mst <instance> cost <cost>','spanning-tree mst <instance> port-priority <priority>',
    'udld port','udld port aggressive','udld port disable','no udld port',
    'channel-protocol lacp','channel-protocol pagp','no channel-protocol','lacp rate fast','lacp rate normal',
    'lacp port-priority <priority>','lacp max-bundle <count>','port-channel min-links <count>'],
  mst:['name <name>','revision <number>','instance <id> vlan <vlans>','no instance <id>',
    'no instance <id> vlan <vlans>','show current','show pending','abort']
};

export function channelPort(d,name) {
  const p=d.ports[name];
  return p?.channel?'Po'+p.channel.id:name;
}

const adminPort=(d,name)=>d.ports[channelPort(d,name)]??d.ports[name];

export function operationalPort(lab,d,name) {
  const raw=d.ports[name],p=adminPort(d,name);
  if(p?.mode!=='dynamic')return p;
  const cable=peer(lab,d,name),other=cable&&deviceById(lab,cable.device);
  const q=other?.type==='switch'?adminPort(other,cable.port):null;
  const domainConflict=Boolean(d.vtp?.domain&&other?.vtp?.domain&&d.vtp.domain!==other.vtp.domain);
  const trunk=Boolean(p.up&&raw?.up&&q?.up&&!domainConflict&&!p.nonegotiate&&!q.nonegotiate&&
    (q.mode==='trunk'||q.mode==='dynamic'&&(p.dtp==='desirable'||q.dtp==='desirable')));
  return {...p,mode:trunk?'trunk':'access'};
}

function trunkPeers(lab,d) {
  return models.switch.ports.flatMap(port=>{
    const cable=peer(lab,d,port), other=cable&&deviceById(lab,cable.device);
    if(other?.type!=='switch'||!linkUp(lab,d,port)||operationalPort(lab,d,port).mode!=='trunk'||
      operationalPort(lab,other,cable.port).mode!=='trunk')return [];
    if((d.ports[port].channel||other.ports[cable.port].channel)&&!bundle(lab,d,port))return [];
    return [{port,other,remote:cable.port}];
  });
}

function sameVtp(a,b) {
  return a?.domain&&a.domain===b?.domain&&(a.password??'')===(b.password??'')&&(a.version??1)===(b.version??1);
}

function vtpDomain(lab,d) {
  const config=d.vtp;
  const seen=new Set([d.id]),queue=[d],members=[];
  while(queue.length){
    const next=queue.shift();
    if(next.vtp?.mode!=='transparent')members.push(next);
    for(const {other} of trunkPeers(lab,next)){
      if(seen.has(other.id)||!other.vtp||other.vtp.mode==='off')continue;
      if(other.vtp.mode!=='transparent'&&!sameVtp(config,other.vtp))continue;
      if(other.vtp.mode==='transparent'&&other.vtp.version!==2&&other.vtp.domain!==config?.domain)continue;
      seen.add(other.id);queue.push(other);
    }
  }
  return members;
}

export function vlanDatabase(lab,d) {
  const vtp=d.vtp,local={vlans:d.vlans,inactive:d.inactiveVlans??[],revision:vtp?.revision??0};
  if(!lab||!vtp?.domain||!['client','server'].includes(vtp.mode))return local;
  const servers=vtpDomain(lab,d).filter(node=>node.vtp?.mode==='server');
  const best=servers.sort((a,b)=>(b.vtp.revision??0)-(a.vtp.revision??0)||Number(a!==d)-Number(b!==d))[0];
  if(best===d&&(!vtp.learned||local.revision>=vtp.learned.revision))return local;
  if(best){
    const revision=best.vtp.revision??0;
    if(!vtp.learned||revision>vtp.learned.revision){
      vtp.learned={vlans:{...best.vlans},inactive:[...(best.inactiveVlans??[])],revision,source:best.name};
      vtp.received=(vtp.received??0)+1;
    }
  }
  return vtp.learned??local;
}

export function allowVlanEdit(d) {
  return d.vtp?.mode!=='client';
}

export function editVlanDatabase(lab,d) {
  const vtp=d.vtp;
  if(vtp?.mode!=='server')return;
  const current=vlanDatabase(lab,d);
  if(current.vlans!==d.vlans){
    d.vlans={...current.vlans};d.inactiveVlans=[...current.inactive];
  }
  vtp.revision=current.revision+1;
  delete vtp.learned;
}

export function vtpPruned(lab,d,name,vlan) {
  if(!d.vtp?.pruning||vlan<2||vlan>1001)return false;
  const first=trunkPeers(lab,d).find(row=>row.port===name)?.other;
  if(!first||!sameVtp(d.vtp,first.vtp)||!['server','client'].includes(first.vtp.mode))return false;
  const seen=new Set([d.id,first.id]),queue=[first];
  while(queue.length){
    const node=queue.shift(),db=vlanDatabase(lab,node);
    if(!Object.hasOwn(db.vlans,vlan))continue;
    if(node.ports['Vlan'+vlan]?.up||models.switch.ports.some(port=>{
      const p=operationalPort(lab,node,port);
      return linkUp(lab,node,port)&&p.mode!=='trunk'&&p.mode!=='routed'&&(p.vlan===vlan||p.voice===vlan);
    }))return false;
    for(const {port,other} of trunkPeers(lab,node)){
      const allowed=operationalPort(lab,node,port).allowed;
      if(!seen.has(other.id)&&(!allowed||allowed.includes(vlan))&&sameVtp(d.vtp,other.vtp)){seen.add(other.id);queue.push(other);}
    }
  }
  return true;
}

export const mstInstance=(d,vlan)=>d.stp?.mode==='mst'?Number(Object.entries(d.mst?.instances??{}).find(([,ids])=>ids.includes(vlan))?.[0]??0):null;
const regionId=d=>JSON.stringify([d.mst?.name??'',d.mst?.revision??0,Object.entries(d.mst?.instances??{})]);
export const sameRegion=(a,b)=>a?.stp?.mode==='mst'&&b?.stp?.mode==='mst'&&regionId(a)===regionId(b);

function mstChanges(d,s,w,c) {
  if(c==='abort'){delete s.pendingMst;s.mode='global';return reply('Pending MST configuration discarded.');}
  const pending=s.pendingMst;
  if(!pending)return invalid('Enter MST configuration mode first.');
  if(c==='show pending'||c==='show current')return reply(mstConfigSummary(c==='show pending'?pending:d.mst));
  if(w[0]==='name'&&keyName(w[1])){pending.name=w[1];return reply();}
  if(w[0]==='revision'&&integer(w[1],0,65535)){pending.revision=Number(w[1]);return reply();}
  const remove=w[0]==='no';
  const [verb,id,_,list]=remove?w.slice(1):w;
  if(verb!=='instance'||!integer(id,1,64))return invalid('Use an MST instance 1–64.');
  if(remove&&!list){delete pending.instances[id];return reply();}
  const vlans=vlanIds(list);
  if(!vlans)return invalid('Enter VLANs such as 72,84,101-110.');
  const ids=new Set(vlans);
  if(remove){pending.instances[id]=(pending.instances[id]??[]).filter(v=>!ids.has(v));return reply();}
  for(const [other,mapped] of Object.entries(pending.instances)){
    if(other!==id)pending.instances[other]=mapped.filter(v=>!ids.has(v));
  }
  pending.instances[id]=[...new Set([...(pending.instances[id]??[]),...vlans])].sort((a,b)=>a-b);
  return reply();
}

export function applyMst(d,s) {
  if(!s.pendingMst)return;
  d.mst=s.pendingMst;
  delete s.pendingMst;
}

const mstConfigSummary=cfg=>['Name: '+(cfg?.name??''),'Revision: '+(cfg?.revision??0),'Instance  VLANs',
  '0  All unmapped VLANs',...Object.entries(cfg?.instances??{}).map(([id,vlans])=>id+'  '+vlans.join(','))].join('\n');

export function campusPort(d,name,args,c) {
  if(d.type!=='switch')return null;
  const p=d.ports[name],no=args[0]==='no',w=no?args.slice(1):args;
  const po=name.startsWith('Po'),phy=models.switch.ports.includes(name);
  if(c.startsWith('switchport mode dynamic ')){
    if(!phy&&!po||p.mode==='routed')return invalid('DTP runs on Layer 2 switchports.');
    p.mode='dynamic';p.dtp=w[3];delete p.nonegotiate;
    return reply();
  }
  if(c==='switchport trunk encapsulation dot1q')return reply('802.1Q encapsulation selected.');
  if(c.startsWith('spanning-tree guard ')){p.stpGuard=w[2];return reply();}
  if(c.startsWith('spanning-tree bpdufilter ')){p.bpdufilter=w[2]==='enable';return reply();}
  if(c.startsWith('spanning-tree link-type ')){p.linkType=w[2];return reply();}
  if(c.startsWith('spanning-tree mst ')){
    const [, , id,key,value]=w;
    if(!integer(id,0,64)||!integer(value,key==='cost'?1:0,key==='cost'?200000000:240)||key==='port-priority'&&Number(value)%16)return invalid('Invalid MST port value.');
    const slots=p.mst??={};(slots[id]??={})[key]=Number(value);return reply();
  }
  if(w[0]==='udld'){
    if(!phy)return invalid('Use a physical port for UDLD.');
    p.udld=no?undefined:w[2]??'normal';return reply();
  }
  if(w[0]==='channel-protocol'){
    if(!phy)return invalid('Use a physical member.');
    if(p.channel&&!no&&lagProtocol(p.channel.mode)!==w[1])return invalid('Remove the existing channel-group first.');
    p.channelProtocol=no?undefined:w[1];return reply();
  }
  if(w[0]==='lacp'||w[0]==='port-channel'){
    const [,key,value]=w;
    if(key==='max-bundle'||key==='min-links'){
      if(!po||!integer(value,1,8))return invalid('Enter a link count of 1–8 on a port-channel.');
      p[key==='max-bundle'?'maxBundle':'minLinks']=Number(value);return reply();
    }
    if(!phy||key==='port-priority'&&!integer(value,1,65535))return invalid('Enter a valid physical LACP member value.');
    p[key==='rate'?'lacpRate':'lacpPriority']=key==='rate'?value:Number(value);return reply();
  }
  return null;
}

export const lagProtocol=mode=>mode==='on'?'static':['active','passive'].includes(mode)?'lacp':'pagp';

function campusShow(lab,d,args,c) {
  const intf=(start)=>interfaceName(args.slice(start));
  if(c.startsWith('show dtp interface')){
    const filter=intf(3);
    return reply(models.switch.ports.filter(port=>!filter||port===filter).map(port=>{
      const p=adminPort(d,port);
      return port+'  '+(p.mode==='dynamic'?'dynamic '+p.dtp:p.mode)+'  Negotiation '+(p.nonegotiate?'Off':'On')+'  Operational '+operationalPort(lab,d,port).mode;
    }).join('\n'));
  }
  if(c.startsWith('show vtp')){
    const cfg=d.vtp, db=vlanDatabase(lab,d);
    if(args[2]==='password')return reply(cfg?.password?'VTP password is configured.':'VTP password is unset.');
    if(args[2]==='counters')return reply('Summary advertisements received: '+(cfg?.received??0)+'\nSubset advertisements received: '+(cfg?.received??0));
    if(args[2]==='devices')return reply(vtpDomain(lab,d).map(node=>node.name+'  '+(node.vtp?.mode??'server')).join('\n'));
    return reply('VTP Operating Mode: '+(cfg?.mode??'server')+'\nVTP Domain Name: '+(cfg?.domain??'—')+
      '\nRunning VTP version: '+(cfg?.version??1)+'\nConfiguration Revision: '+db.revision+'\nVLANs: '+Object.keys(db.vlans).length+
      '\nVTP Pruning Mode: '+(cfg?.pruning?'Enabled':'Disabled'));
  }
  if(c.startsWith('show etherchannel ')&&(args[2]==='load-balance'||args[3]==='detail')){
    if(args[2]==='load-balance')return reply('EtherChannel Load-Balancing Configuration: '+(d.lagHash??'src-mac'));
    const name='Po'+args[2],channel=d.ports[name],members=memberPorts(lab,d,name);
    return reply(channel?name+' is '+(linkUp(lab,d,name)?'up':'down')+' · '+(channel.mode==='routed'?'Layer 3':'Layer 2')+
      '\nBundled members: '+(members.join(', ')||'none')+'\nMinimum links: '+(channel.minLinks??1):'No matching channel group.');
  }
  if(c==='show lacp neighbor'||c==='show pagp neighbor'){
    const rows=models.switch.ports.flatMap(port=>{
      const p=d.ports[port],group=p.channel&&bundle(lab,d,port);
      return group&&lagProtocol(p.channel.mode)===args[1]&&linkUp(lab,d,port)?[port+'  Partner '+group.other.name+
        '  '+peer(lab,d,port).port+'  Sync '+(memberPorts(lab,d,'Po'+group.left).includes(port)?'yes':'standby')]:[];
    });
    return reply(rows.join('\n')||'No '+args[1].toUpperCase()+' neighbors.');
  }
  if(c.startsWith('show spanning-tree mst configuration'))return reply(mstConfigSummary(d.mst));
  if(c.startsWith('show spanning-tree mst')){
    const at=args.indexOf('interface'),selected=at<0?null:intf(at+1),id=integer(args[3],0,64)?Number(args[3]):null;
    if(d.stp?.mode!=='mst')return reply('Multiple spanning tree mode is disabled.');
    const db=vlanDatabase(lab,d);
    const vlans=[...new Set(Object.keys(db.vlans).map(Number))];
    const ids=id===null?[...new Set(vlans.map(v=>mstInstance(d,v)))]:[id];
    return reply(ids.flatMap(number=>{
      const selection=vlans.filter(vlan=>mstInstance(d,vlan)===number);
      const row=selection.length?bridgeState(lab,selection[0]).get(d.id):null;
      return ['MST'+number+'  Root: '+(row?.root?.name??'—')+'  VLANs: '+(selection.join(',')||'unmapped'),
        ...models.switch.ports.filter(port=>!selected||selected===port).flatMap(port=>{
          const remote=peer(lab,d,port),node=remote&&deviceById(lab,remote.device);
          if(!row?.ports[port]&&!node)return [];
          return [port+'  '+(row?.ports[port]??'—')+'  '+(sameRegion(d,node)?'Internal':'Boundary')];
        })];
    }).join('\n'));
  }
  if(c.startsWith('show spanning-tree interface ')||c==='show spanning-tree inconsistentports'||c==='show interfaces status err-disabled'){
    const port=args[2]==='interface'?interfaceName(args.slice(3).filter(word=>word!=='detail')):null;
    const rows=Object.keys(vlanDatabase(lab,d).vlans).flatMap(vlan=>{
      const tree=bridgeState(lab,Number(vlan)).get(d.id);
      return Object.entries(tree?.ports??{}).filter(([name,role])=>port?name===port:args[1]==='interfaces'?
        role==='err-disabled':role.endsWith('inconsistent')).map(([name,role])=>'VLAN '+vlan+'  '+name+'  '+role);
    });
    const shut=Object.entries(d.ports).filter(([,p])=>p.security?.disabled).map(([name])=>name+'  err-disabled  psecure-violation');
    return reply([...rows,...(args[1]==='interfaces'?shut:[])].join('\n')||'No matching spanning-tree ports.');
  }
  if(c==='show spanning-tree uplinkfast')return reply('UplinkFast '+(d.stp?.uplinkfast?'enabled':'disabled'));
  if(c==='show errdisable recovery')return reply(['Recovery interval: '+(d.errdisable?.interval??300)+' seconds',...Object.entries(d.errdisable?.causes??{}).
    map(([name,on])=>name+'  '+(on?'Enabled':'Disabled'))].join('\n'));
  if(c.startsWith('show udld interface')){
    const port=intf(3);
    if(!models.switch.ports.includes(port))return invalid('Select a physical switchport.');
    const remote=peer(lab,d,port),other=remote&&deviceById(lab,remote.device);
    return reply(port+'  Administrative '+(d.ports[port].udld??'disabled')+'  Operational '+(!linkUp(lab,d,port)?'link down':
      d.ports[port].udld&&d.ports[port].udld!=='disable'&&other?.ports[remote.port]?.udld&&other.ports[remote.port].udld!=='disable'?'bidirectional':'undetermined'));
  }
  return null;
}

export function campusCLI(lab,d,s,args,c) {
  if(d.type!=='switch')return null;
  if(s.mode==='mst'&&(args[0]!=='show'||['current','pending'].includes(args[1])))return mstChanges(d,s,args,c);
  if(args[0]==='show')return campusShow(lab,d,args,c);
  if(s.mode!=='global')return null;
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(w[0]==='vtp'){
    const cfg=d.vtp??={mode:'server',version:1,revision:0};
    const [,field,value]=w;
    if(field==='domain'&&keyName(value)){
      if(cfg.domain!==value){cfg.domain=value;cfg.revision=0;delete cfg.learned;}return reply();
    }
    if(field==='mode'){cfg.mode=value;delete cfg.learned;if(['off','transparent'].includes(value))cfg.revision=0;return reply();}
    if(field==='version'&&integer(value,1,2)){cfg.version=Number(value);delete cfg.learned;return reply();}
    if(field==='password'){cfg.password=no?undefined:value;delete cfg.learned;return reply();}
    if(field==='pruning'){cfg.pruning=!no;return reply();}
    return invalid('Use a VTP version 1 or 2, domain, password or operating mode.');
  }
  if(w[0]==='port-channel'){d.lagHash=w[2];return reply();}
  if(w[0]==='lacp'){
    if(!integer(w[2],1,65535))return invalid('Use LACP priority 1–65535.');
    d.lacpSystemPriority=Number(w[2]);return reply();
  }
  if(w[0]==='errdisable'){
    const cfg=d.errdisable??={causes:{}};
    if(w[2]==='cause'){cfg.causes[w[3]]=!no;return reply();}
    if(w[2]==='interval'&&integer(w[3],30,86400)){cfg.interval=Number(w[3]);return reply();}
    return invalid('Use an errdisable recovery interval of 30–86400 seconds.');
  }
  if(w[0]!=='spanning-tree')return null;
  const stp=d.stp??={};
  if(w[1]==='mst'&&w[2]==='configuration'){
    s.pendingMst=structuredClone(d.mst??{name:'',revision:0,instances:{}});
    return enter(s,'mst',null);
  }
  if(w[1]==='mst'){
    if(!integer(w[2],0,64)||w[3]==='priority'&&(!integer(w[4],0,61440)||Number(w[4])%4096))return invalid('Check the MST instance or priority step of 4096.');
    (stp.instances??={})[w[2]]=w[3]==='priority'?Number(w[4]):w[4]==='primary'?24576:28672;return reply();
  }
  if(['uplinkfast','backbonefast'].includes(w[1])){stp[w[1]]=!no;return reply();}
  if(w[1]==='vlan'&&['hello-time','max-age','forward-time'].includes(w[3])){
    const limits={'hello-time':[1,10],'max-age':[6,40],'forward-time':[4,30]};
    if(!integer(w[2],1,4094)||!integer(w[4],...limits[w[3]]))return invalid('Check the VLAN and timer range.');
    ((stp.vlans??={})[w[2]]??={})[w[3]]=Number(w[4]);return reply();
  }
  return null;
}

export function campusRunning(d) {
  const v=d.vtp;
  return [
    ...(v?[v.domain?'vtp domain '+v.domain:null,'vtp mode '+v.mode,'vtp version '+v.version,v.password?'vtp password [configured]':null,
      v.pruning?'vtp pruning':null].filter(Boolean):[]),
    ...(d.mst?['spanning-tree mst configuration',...(d.mst.name?[' name '+d.mst.name]:[]),' revision '+d.mst.revision,
      ...Object.entries(d.mst.instances).filter(([,vlans])=>vlans.length).map(([id,vlans])=>' instance '+id+' vlan '+vlans.join(','))]:[]),
    ...Object.entries(d.stp?.instances??{}).map(([id,priority])=>'spanning-tree mst '+id+' priority '+priority),
    ...(d.lagHash?['port-channel load-balance '+d.lagHash]:[]),
    ...(d.lacpSystemPriority?['lacp system-priority '+d.lacpSystemPriority]:[]),
    ...(d.errdisable?.interval?['errdisable recovery interval '+d.errdisable.interval]:[]),
    ...Object.entries(d.errdisable?.causes??{}).filter(([,on])=>on).map(([cause])=>'errdisable recovery cause '+cause)
  ];
}

export function campusPortLines(p) {
  return [
    ...(p.stpGuard?[' spanning-tree guard '+p.stpGuard]:[]),...(p.bpdufilter!==undefined?[' spanning-tree bpdufilter '+(p.bpdufilter?'enable':'disable')]:[]),
    ...(p.linkType?[' spanning-tree link-type '+p.linkType]:[]),...(p.udld?[' udld port'+(p.udld==='normal'?'':' '+p.udld)]:[]),
    ...(p.minLinks?[' port-channel min-links '+p.minLinks]:[]),...(p.maxBundle?[' lacp max-bundle '+p.maxBundle]:[]),
    ...(p.lacpPriority?[' lacp port-priority '+p.lacpPriority]:[]),...(p.lacpRate?[' lacp rate '+p.lacpRate]:[]),
    ...(p.channelProtocol?[' channel-protocol '+p.channelProtocol]:[]),
    ...Object.entries(p.mst??{}).flatMap(([id,values])=>Object.entries(values).map(([key,value])=>' spanning-tree mst '+id+' '+key+' '+value))
  ];
}
