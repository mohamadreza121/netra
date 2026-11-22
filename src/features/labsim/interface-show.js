import { channelPort, operationalPort, vlanDatabase, vtpPruned } from './campus.js';
import { interfaceName } from './ios.js';
import { deviceById, linkUp, models, parentPort, peer, vlanEgress, vlanExists } from './network.js';
import { bridgeState, memberPorts, stpForwards } from './switching.js';
import { invalid, reply } from './cli-utils.js';

const isSwitchport=(d,name,p)=>d.type==='switch'&&p.mode!=='routed'&&!/^(?:Vlan|Lo|Tu)/.test(name);

export function vlanRanges(list) {
  if(!list.length)return 'none';
  const sorted=[...new Set(list)].sort((a,b)=>a-b), ranges=[];
  let first=sorted[0],last=first;
  for(const id of sorted.slice(1)){
    if(id===last+1){last=id;continue;}
    ranges.push(first===last?String(first):first+'-'+last);
    first=last=id;
  }
  ranges.push(first===last?String(first):first+'-'+last);
  return ranges.join(',');
}

export const interfaceStatus = (lab,d,name) => {
  const p=d.ports[name],up=linkUp(lab,d,name);
  return {up,state:up?'up':p.up?'down':'administratively down',protocol:up?'up':'down'};
};

function lineSpeed(lab,d,name) {
  const p=d.ports[name],cable=peer(lab,d,parentPort(name));
  const other=cable&&deviceById(lab,cable.device),remote=other?.ports[cable.port];
  const physical=/^(?:Gi|Po)/.test(name);
  const limit=other?.type==='phone'?100:1000;
  const speed=p.speed&&p.speed!=='auto'?Number(p.speed):physical?Math.min(limit,Number(remote?.speed)||limit):null;
  const bandwidth=p.bandwidth??(speed?speed*1000:name.startsWith('Lo')?8000000:null);
  const duplex=p.duplex&&p.duplex!=='auto'?p.duplex:remote?.duplex==='half'?'half':'full';
  return {speed,bandwidth,duplex};
}

function description(lab,d,entries){
  return ['Interface                      Status                  Protocol Description',...entries.map(([name,p])=>{
    const {state,protocol}=interfaceStatus(lab,d,name);
    return name.padEnd(31)+state.padEnd(24)+protocol.padEnd(9)+(p.description??'');
  })].join('\n');
}

function statusView(lab,d,entries,disabledOnly) {
  const trees=new Map();
  const rows=entries.flatMap(([name,p])=>{
    const mode=d.type==='switch'?operationalPort(lab,d,name):p;
    const sw=isSwitchport(d,name,p);
    const activeVlan=mode.mode==='trunk'?mode.native:mode.vlan;
    if(sw&&!trees.has(activeVlan))trees.set(activeVlan,bridgeState(lab,activeVlan));
    const bpdu=sw&&trees.get(activeVlan)?.get(d.id)?.ports[name]==='err-disabled';
    const disabled=p.security?.disabled||bpdu;
    if(disabledOnly)return disabled?[name.padEnd(10)+(p.description??'').slice(0,18).padEnd(19)+'err-disabled  '+(bpdu?'bpduguard':'psecure-violation')]:[];
    const {up}=interfaceStatus(lab,d,name);
    const inactive=sw&&mode.mode==='access'&&!vlanExists(d,mode.vlan,lab);
    const state=disabled?'err-disabled':!p.up?'disabled':!up?'notconnect':inactive?'inactive':'connected';
    const vlan=sw?(mode.mode==='trunk'?'trunk':String(mode.vlan??1)):'routed';
    const {speed,duplex}=lineSpeed(lab,d,name);
    const short=duplex==='half'?'half':'full';
    return [name.padEnd(10)+(p.description??'').slice(0,18).padEnd(19)+state.padEnd(15)+vlan.padEnd(8)+
      (p.duplex&&p.duplex!=='auto'?short:up?'a-'+short:'auto').padEnd(9)+(p.speed&&p.speed!=='auto'?p.speed:up&&speed?'a-'+speed:'auto').padEnd(8)+
      (name.startsWith('Gi')?'10/100/1000BaseTX':name.startsWith('Po')?'EtherChannel':'Virtual')];
  });
  const header=disabledOnly?'Port      Name               Status        Reason':'Port      Name               Status         Vlan    Duplex   Speed   Type';
  return [header,...rows].join('\n');
}

function switchportView(lab,d,entries) {
  const {vlans,inactive}=vlanDatabase(lab,d);
  const label=id=>id?(id+' ('+(vlans[id]??'inactive')+(inactive.includes(id)?', suspended':'')+')'):'none';
  const modeName=p=>p.mode==='access'?'static access':p.mode==='dynamic'?'dynamic '+p.dtp:p.mode;
  return entries.map(([name,p])=>{
    if(!isSwitchport(d,name,p))return 'Name: '+name+'\nSwitchport: Disabled';
    const active=operationalPort(lab,d,name);
    return [
      'Name: '+name,'Switchport: Enabled','Administrative Mode: '+modeName(p),
      'Operational Mode: '+(linkUp(lab,d,name)?modeName(active):'down'),
      'Administrative Trunking Encapsulation: dot1q','Operational Trunking Encapsulation: '+(active.mode==='trunk'&&linkUp(lab,d,name)?'dot1q':'native'),
      'Negotiation of Trunking: '+(active.nonegotiate?'Off':'On'),'Access Mode VLAN: '+label(active.vlan),
      'Trunking Native Mode VLAN: '+label(active.native),'Voice VLAN: '+label(active.voice),
      'Trunking VLANs Enabled: '+(active.allowed?vlanRanges(active.allowed):'ALL')
    ].join('\n');
  }).join('\n\n');
}

function trunkView(lab,d,entries,specific) {
  const db=vlanDatabase(lab,d);
  const trees=new Map();
  const rows=entries.flatMap(([name,p])=>{
    const op=operationalPort(lab,d,name),logical=channelPort(d,name);
    if(logical!==name&&!specific)return [];
    if(op.mode!=='trunk'&&!(specific&&['trunk','dynamic'].includes(p.mode)))return [];
    const members=logical.startsWith('Po')?memberPorts(lab,d,logical):[name];
    const trunkUp=op.mode==='trunk'&&linkUp(lab,d,name)&&(name===logical||members.includes(name));
    if(!specific&&!trunkUp)return [];
    const enabled=Object.keys(db.vlans).map(Number).filter(id=>!db.inactive.includes(id)&&vlanEgress(op,id)!==undefined);
    const forwarded=enabled.filter(id=>{
      if(!trunkUp)return false;
      if(!trees.has(id))trees.set(id,bridgeState(lab,id));
      const ports=trees.get(id).get(d.id)?.ports;
      const outgoing=name===logical?members:[name];
      return outgoing.some(port=>stpForwards(ports?.[port])&&!vtpPruned(lab,d,port,id));
    });
    return [{name,mode:p.mode==='dynamic'?p.dtp:'on',up:trunkUp,native:op.native,
      allowed:op.allowed?vlanRanges(op.allowed):'1-4094',enabled:vlanRanges(enabled),forwarded:vlanRanges(forwarded)}];
  });
  if(!rows.length)return 'No operational trunk ports.';
  return [
    'Port        Mode         Encapsulation  Status        Native vlan',
    ...rows.map(row=>row.name.padEnd(12)+row.mode.padEnd(13)+'802.1q'.padEnd(15)+(row.up?'trunking':'not-trunking').padEnd(14)+row.native),
    '', 'Port        Vlans allowed on trunk', ...rows.map(row=>row.name.padEnd(12)+row.allowed),
    '', 'Port        Vlans allowed and active in management domain', ...rows.map(row=>row.name.padEnd(12)+row.enabled),
    '', 'Port        Vlans in spanning tree forwarding state and not pruned', ...rows.map(row=>row.name.padEnd(12)+row.forwarded)
  ].join('\n');
}

function ipInfo(lab,d,name,p) {
  const {state,protocol}=interfaceStatus(lab,d,name);
  const unassigned='  Internet protocol processing disabled';
  return [name+' is '+state+', line protocol is '+protocol,
    ...(p.address?['  Internet address is '+p.address+'/'+p.prefix,
      '  Helper address is '+(p.helper??'not set'),'  Inbound access list is '+(p.acl?.in??'not set'),
      '  Outgoing access list is '+(p.acl?.out??'not set')]:[unassigned]),
    ...(p.vrf?['  VPN Routing/Forwarding "'+p.vrf+'"']:[]),
    ...(p.urpf?.ip?['  IP verify source reachable-via '+p.urpf.ip.mode+(p.urpf.ip.allowDefault?' allow-default':'')]:[])
  ];
}

function generalInfo(lab,d,name,p) {
  const {state,protocol,up}=interfaceStatus(lab,d,name),{speed,bandwidth,duplex}=lineSpeed(lab,d,name);
  const port=models[d.type].ports.includes(name);
  const hw=port?'Gigabit Ethernet':name.startsWith('Lo')?'Loopback':name.startsWith('Po')?'EtherChannel':name.startsWith('Tu')?'Tunnel':name.startsWith('Vlan')?'Ethernet SVI':'802.1Q subinterface';
  return [
    name+' is '+state+', line protocol is '+protocol+(port&&d.type==='switch'?' ('+(up?'connected':p.up?'notconnect':'disabled')+')':''),
    '  Hardware is '+hw,
    ...(p.description?['  Description: '+p.description]:[]),
    ...(p.address?['  Internet address is '+p.address+'/'+p.prefix]:[]),
    '  MTU '+(p.mtu??1500)+' bytes'+(bandwidth?', BW '+bandwidth+' Kbit/sec':''),
    '  Encapsulation '+(p.tag?'802.1Q Virtual LAN, Vlan ID '+p.tag+(p.nativeEncapsulation?' (native)':''):name.startsWith('Tu')?'Tunnel':'ARPA'),
    ...(port?['  '+(!up&&!p.duplex?'Auto duplex':duplex==='half'?'Half-duplex':'Full-duplex')+', '+(!up&&!p.speed?'Auto speed':speed+'Mb/s')]:[]),
    ...(p.vrf?['  VRF: '+p.vrf]:[])
  ];
}

export function interfacesShow(lab,d,args) {
  const ip=args[1]==='ip';
  const tail=args.slice(ip?3:2);
  if(ip&&tail[0]==='brief'){
    return reply(['Interface              IP-Address      OK? Method Status                Protocol',...Object.entries(d.ports).map(([name,p])=>{
      const {state,protocol}=interfaceStatus(lab,d,name);
      return name.padEnd(23)+(p.address??'unassigned').padEnd(16)+'YES '+(p.address?'manual':'unset').padEnd(7)+state.padEnd(22)+protocol;
    })].join('\n'));
  }
  const disabledOnly=tail.at(-1)==='err-disabled';
  if(disabledOnly)tail.pop();
  const view=['description','switchport','status','trunk'].includes(tail.at(-1))?tail.pop():null;
  const specific=tail.length>0;
  const name=specific?interfaceName(tail):null;
  if(specific&&!Object.hasOwn(d.ports,name))return invalid('This interface does not exist.');
  const entries=specific?[[name,d.ports[name]]]:Object.entries(d.ports);
  if(view==='description')return reply(description(lab,d,entries));
  if(view==='status')return reply(statusView(lab,d,entries,disabledOnly));
  if(view==='switchport')return reply(switchportView(lab,d,entries));
  if(view==='trunk')return reply(trunkView(lab,d,entries,specific));
  return reply(entries.map(([port,p])=>(ip?ipInfo:generalInfo)(lab,d,port,p).join('\n')).join('\n\n'));
}
