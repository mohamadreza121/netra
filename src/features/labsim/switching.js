import { deviceById, linkUp, macAddress, models, peer, vlanExists, vlanIngress, vlanEgress } from './network.js';
import { channelPort, lagProtocol, mstInstance, operationalPort, sameRegion, vlanDatabase } from './campus.js';

const channel = (a,b) => {
  if (!a || !b) return false;
  if (a==='on'||b==='on') return a===b;
  const modes = new Set([a,b]);
  return (modes.has('active')&&[...modes].every(m=>['active','passive'].includes(m))) ||
    (modes.has('desirable')&&[...modes].every(m=>['auto','desirable'].includes(m)));
};

export function restoreChannelPorts(device) {
  if(device.type!=='switch')return;
  for(const p of Object.values(device.ports)){
    if(!p.channel)continue;
    const name='Po'+p.channel.id;
    device.ports[name]??={up:true,mode:p.mode,vlan:p.vlan,native:p.native,allowed:p.allowed?.slice(),dtp:p.dtp};
  }
}

export function bundle(lab,d,port,knownFar) {
  const local=d.ports[port]?.channel;
  const far=knownFar??peer(lab,d,port);
  const other=far&&deviceById(lab,far.device);
  const remote=other?.ports[far.port]?.channel;
  if (!local||!remote||other.type!=='switch'||!channel(local.mode,remote.mode)) return null;
  const a=operationalPort(lab,d,port),b=operationalPort(lab,other,far.port);
  if(a.mode!==b.mode)return null;
  return {left:local.id,right:remote.id,other};
}

function rankedMembers(lab,d,name) {
  const p=d.ports[name];
  if(!p?.up||d.type!=='switch')return [];
  const choices=models.switch.ports.filter(port=>channelPort(d,port)===name&&linkUp(lab,d,port))
    .flatMap(port=>{const group=bundle(lab,d,port);return group?[{port,...group}]:[];});
  const priority=group=>group.other.lacpSystemPriority??32768;
  choices.sort((a,b)=>priority(a)-priority(b)||a.other.id.localeCompare(b.other.id,undefined,{numeric:true})||
    (d.ports[a.port].lacpPriority??32768)-(d.ports[b.port].lacpPriority??32768)||a.port.localeCompare(b.port,undefined,{numeric:true}));
  if(!choices.length)return [];
  const first=choices[0];
  return choices.filter(group=>group.other===first.other&&group.right===first.right).slice(0,p.maxBundle??8);
}

export function memberPorts(lab,d,name) {
  const local=rankedMembers(lab,d,name);
  if(!local.length)return [];
  const first=local[0],remoteName='Po'+first.right;
  const remote=rankedMembers(lab,first.other,remoteName).filter(row=>row.other===d&&'Po'+row.right===name);
  const joined=local.filter(row=>remote.some(end=>end.port===peer(lab,d,row.port)?.port)).map(row=>row.port);
  const minimum=Math.max(d.ports[name]?.minLinks??1,first.other.ports[remoteName]?.minLinks??1);
  return joined.length>=minimum?joined:[];
}

const stpPriority=(device,vlan,common=false)=>{
  const instance=mstInstance(device,vlan);
  return instance===null?device.stp?.vlans?.[vlan]?.priority??32768:device.stp?.instances?.[common?0:instance]??32768;
};
const portCost=(device,port,vlan)=>{
  const p=device.ports[port],intf=operationalPortPlaceholder(device,port);
  const instance=mstInstance(device,vlan);
  const specific=instance===null?undefined:intf.mst?.[instance]?.cost??p.mst?.[instance]?.cost;
  return specific??intf.stp?.[vlan]?.cost??p.stp?.[vlan]?.cost??intf.stp?.all?.cost??p.stp?.all?.cost??
    (instance!==null?(p.speed==='100'?200000:p.speed==='10'?2000000:20000):p.speed==='100'?19:p.speed==='10'?100:4);
};
const operationalPortPlaceholder=(d,port)=>d.ports[channelPort(d,port)]??d.ports[port];

export function bridgeState(lab, vlan) {
  const nodes=lab.devices.filter(d=>d.type==='switch'&&vlanExists(d,vlan,lab));
  const base=new Map(nodes.map(d=>[d.id,{}]));
  const links=new Map();
  const portKey=(d,name)=>d.id+':'+name;
  const members=new Map();
  const inBundle=(d,port)=>{
    const name=channelPort(d,port);
    if(name===port)return true;
    const key=portKey(d,name);
    if(!members.has(key))members.set(key,memberPorts(lab,d,name));
    return members.get(key).includes(port);
  };
  for (const {a,b} of lab.links) {
    const left=deviceById(lab,a.device), right=deviceById(lab,b.device);
    if (!base.has(left.id)||!base.has(right.id)||!linkUp(lab,left,a.port)) continue;
    const rawX=left.ports[a.port],rawY=right.ports[b.port];
    const x=operationalPort(lab,left,a.port),y=operationalPort(lab,right,b.port);
    const xx=vlanEgress(x,vlan), yy=vlanEgress(y,vlan);
    if (xx===undefined||yy===undefined||vlanIngress(y,xx)!==vlan||vlanIngress(x,yy)!==vlan) continue;
    const guardX=(rawX.bpduguard??x.bpduguard)??(left.stp?.guard&&(rawX.portfast??x.portfast??left.stp?.portfast)&&x.mode==='access');
    const guardY=(rawY.bpduguard??y.bpduguard)??(right.stp?.guard&&(rawY.portfast??y.portfast??right.stp?.portfast)&&y.mode==='access');
    if(guardX&&!rawY.bpdufilter){base.get(left.id)[a.port]='err-disabled';continue;}
    if(guardY&&!rawX.bpdufilter){base.get(right.id)[b.port]='err-disabled';continue;}
    if(rawX.bpdufilter||rawY.bpdufilter){
      if((rawX.stpGuard??x.stpGuard)==='loop'&&rawY.bpdufilter)base.get(left.id)[a.port]='loop-inconsistent';
      if((rawY.stpGuard??y.stpGuard)==='loop'&&rawX.bpdufilter)base.get(right.id)[b.port]='loop-inconsistent';
      continue;
    }
    const group=bundle(lab,left,a.port,b);
    if ((rawX.channel||rawY.channel)&&(!group||!inBundle(left,a.port)||!inBundle(right,b.port))) {
      base.get(left.id)[a.port]='suspended';base.get(right.id)[b.port]='suspended';
      continue;
    }
    const key=group?[portKey(left,group.left),portKey(right,group.right)].sort().join('-'):portKey(left,a.port);
    if (links.has(key)) {links.get(key).members.push({a,b});continue;}
    links.set(key,{left,right,a,b,members:[{a,b}]});
  }

  const side=(edge,d)=>edge.left===d?edge.a:edge.b;
  const rootGuard=(d,port)=>(d.ports[port].stpGuard??operationalPortPlaceholder(d,port).stpGuard)==='root';
  while(true){
    const state=new Map(nodes.map(d=>[d.id,{root:d,ports:{...base.get(d.id)}}]));
    const edges=new Map(nodes.map(d=>[d.id,[]]));
    for(const edge of links.values()){
      edges.get(edge.left.id).push(edge);edges.get(edge.right.id).push(edge);
    }
    const unvisited=new Set(nodes.map(d=>d.id));
    const rejected=new Set();
    const compare=(a,b)=>stpPriority(a,vlan,!sameRegion(a,b))-stpPriority(b,vlan,!sameRegion(a,b))||a.id.localeCompare(b.id,undefined,{numeric:true});
    for(const root of [...nodes].sort(compare)){
      if(!unvisited.has(root.id))continue;
      const paths=new Map([[root.id,{device:root,cost:0}]]);
      while(true){
        const row=[...paths.values()].filter(entry=>unvisited.has(entry.device.id)).sort((a,b)=>a.cost-b.cost||compare(a.device,b.device))[0];
        if(!row)break;
        const {device,cost}=row;
        unvisited.delete(device.id);
        state.get(device.id).root=root;
        if(row.edge&&rootGuard(device,side(row.edge,device).port))rejected.add(row.edge);
        for(const edge of edges.get(device.id)){
          const other=edge.left===device?edge.right:edge.left;
          if(!unvisited.has(other.id))continue;
          const end=side(edge,other);
          const next=cost+portCost(other,end.port,vlan);
          const current=paths.get(other.id);
          if(!current||next<current.cost||
            next===current.cost&&(compare(device,current.via)<0||device===current.via&&portPriority(device,side(edge,device).port,vlan)<
              portPriority(device,side(current.edge,device).port,vlan))){
            paths.set(other.id,{device:other,cost:next,via:device,edge});
          }
        }
      }
      for(const [id,row] of paths)for(const edge of edges.get(id)){
        const other=edge.left===row.device?edge.right:edge.left,far=paths.get(other.id);
        if(!far)continue;
        const role=row.edge===edge?'Root':far.edge===edge||row.cost<far.cost||row.cost===far.cost&&compare(row.device,other)<0?'Desg':'Altn';
        for(const member of edge.members){
          const end=member.a.device===id?member.a:member.b;
          state.get(id).ports[end.port]=role;
        }
      }
    }
    if(!rejected.size)return state;
    for(const [key,edge] of links)if(rejected.has(edge)){
      for(const {a,b} of edge.members)for(const end of [a,b]){
        const device=deviceById(lab,end.device);
        if(rootGuard(device,end.port))base.get(device.id)[end.port]='root-inconsistent';
      }
      links.delete(key);
    }
  }
}

function portPriority(d,name,vlan) {
  const p=d.ports[name],channel=operationalPortPlaceholder(d,name);
  const instance=mstInstance(d,vlan);
  return channel.mst?.[instance]?.['port-priority']??p.mst?.[instance]?.['port-priority']??channel.stp?.[vlan]?.['port-priority']??p.stp?.[vlan]?.['port-priority']??128;
}

export function permitsSwitchIngress(device,port,source) {
  const setting=device.ports[port]?.security;
  if (!setting?.enabled) return true;
  if (setting.disabled) return false;
  if (source===device) return true;
  const mac=macAddress(source);
  setting.learned??=[];
  const secure=[...new Set([...(setting.static??[]),...setting.learned])];
  if (secure.includes(mac)) return true;
  if (secure.length<(setting.maximum??1)) {setting.learned.push(mac);return true;}
  setting.violations=(setting.violations??0)+1;
  if ((setting.violation??'shutdown')==='shutdown') setting.disabled=true;
  return false;
}

const macFormat = /^(?:[\da-f]{4}\.){2}[\da-f]{4}$/i;

export function switchingConfig(d,port,args,c) {
  const no=args[0]==='no';
  const words=no?args.slice(1):args;
  const number = (raw,min,max)=>/^\d+$/.test(raw??'')&&Number(raw)>=min&&Number(raw)<=max;
  const setting=d.ports[port];
  if (words[0]==='channel-group') {
    if(!models.switch.ports.includes(port))return 'Use a physical member interface.';
    if (no) {delete setting.channel;return '';}
    if (!number(words[1],1,48))return 'Use channel group 1–48.';
    const id=Number(words[1]);
    const mode=words[3];
    if(Object.entries(d.ports).some(([name,p])=>name!==port&&p.channel?.id===id&&p.channel.mode!==mode))return 'Group members must use the same channel mode.';
    if(setting.channelProtocol&&setting.channelProtocol!==lagProtocol(mode))return 'The group does not match channel-protocol.';
    const logical='Po'+id;
    d.ports[logical]??={up:true,mode:setting.mode,vlan:setting.vlan,native:setting.native,allowed:setting.allowed?.slice(),dtp:setting.dtp};
    setting.channel={id,mode};return '';
  }
  if (words[1]==='port-security'&&words[0]==='switchport') {
    setting.security??={};const sec=setting.security;
    if(!words[2]){sec.enabled=!no;delete sec.disabled;return '';}
    if(words[2]==='maximum'&&number(words[3],1,64)){sec.maximum=Number(words[3]);return '';}
    if(words[2]==='violation'){sec.violation=words[3];return '';}
    if(words[3]==='sticky'){sec.sticky=!no;return '';}
    if(macFormat.test(words[3]??'')){
      const mac=words[3].toLowerCase();
      const previous=(sec.static??[]).filter(x=>x!==mac);
      if(!no)previous.push(mac);
      sec.static=previous;return '';
    }
    return 'Check the port-security arguments.';
  }
  if(words[0]!=='spanning-tree')return null;
  if(port&&words[1]==='portfast'){setting.portfast=words[2]!=='disable'&&!no;return '';}
  if(port&&words[1]==='bpduguard'){setting.bpduguard=words[2]==='enable';return '';}
  if(!port&&words[1]==='mode'){d.stp??={};d.stp.mode=words[2];return '';}
  if(!port&&words[1]==='portfast'){
    d.stp??={};d.stp[words[2]==='bpduguard'?'guard':'portfast']=!no;return '';
  }
  const vlan=words[1]==='vlan'?Number(words[2]):'all';
  const pair=words.slice(vlan==='all'?1:3);
  if(vlan!=='all'&&!number(String(vlan),1,4094))return 'Use VLAN 1–4094.';
  if(port){
    const [field,value]=pair;
    if(!(field==='cost'&&number(value,1,200000000)||field==='port-priority'&&number(value,0,240)&&Number(value)%16===0))return 'Check the spanning-tree cost or priority.';
    setting.stp??={};setting.stp[vlan]??={};setting.stp[vlan][field]=Number(value);return '';
  }
  const [field,value]=pair;
  if(field==='root'||(field==='priority'&&number(value,0,61440)&&Number(value)%4096===0)) {
    d.stp??={};d.stp.vlans??={};
    d.stp.vlans[vlan]={...d.stp.vlans[vlan],priority:field==='root'?(value==='primary'?24576:28672):Number(value)};
    return '';
  }
  return 'Check the spanning-tree configuration arguments.';
}

export function switchingShow(lab,device,args) {
  if (args[1]==='spanning-tree') {
    const id=args[2]==='vlan'?Number(args[3]):null;
    const vlans=id?[id]:Object.keys(vlanDatabase(lab,device).vlans).map(Number);
    return vlans.flatMap(vlan=>{
      const row=bridgeState(lab,vlan).get(device.id);
      if(!row)return [];
      const ports=models.switch.ports.filter(port=>linkUp(lab,device,port)&&vlanEgress(operationalPort(lab,device,port),vlan)!==undefined);
      return [`VLAN${String(vlan).padStart(4,'0')}  Root: ${row.root.name}  Mode: ${device.stp?.mode??'pvst'}`,
        ...ports.map(port=>{const role=row.ports[port]??'Desg';return '  '+port+'  '+role+'  '+(role==='Altn'?'BLK':['suspended','err-disabled','root-inconsistent','loop-inconsistent'].includes(role)?'DOWN':'FWD');})];
    }).join('\n')||'No active spanning-tree instances.';
  }
  if (args[1]==='etherchannel') {
    const groups=Object.entries(device.ports).filter(([,p])=>p.channel&&(!args[2]||args[2]==='summary'||p.channel.id===Number(args[2])));
    return groups.map(([port,p])=>'Po'+p.channel.id+'  '+p.channel.mode+'  '+port+'  '+(memberPorts(lab,device,'Po'+p.channel.id).includes(port)?'bundled':'standalone / suspended')).join('\n')||'No EtherChannel groups.';
  }
  const name=args.length>2?args.slice(3).join(''):null;
  return Object.entries(device.ports).filter(([port,p])=>p.security&&(!name||port.toLowerCase()===name.toLowerCase()))
    .map(([port,p])=>`${port}  ${p.security.disabled?'secure-shutdown':p.security.enabled?'secure-up':'disabled'}  Maximum ${p.security.maximum??1}  Violations ${p.security.violations??0}`).join('\n')||'No port-security entries.';
}
