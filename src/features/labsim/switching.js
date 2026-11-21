import { deviceById, linkUp, macAddress, models, peer, vlanExists, vlanIngress, vlanEgress } from './network.js';

const channel = (a,b) => {
  if (!a || !b) return false;
  if (a==='on'||b==='on') return a===b;
  const modes = new Set([a,b]);
  return (modes.has('active')&&[...modes].every(m=>['active','passive'].includes(m))) ||
    (modes.has('desirable')&&[...modes].every(m=>['auto','desirable'].includes(m)));
};

export function bundle(lab,d,port,knownFar) {
  const local=d.ports[port]?.channel;
  const far=knownFar??peer(lab,d,port);
  const other=far&&deviceById(lab,far.device);
  const remote=other?.ports[far.port]?.channel;
  if (!local||!remote||other.type!=='switch'||!channel(local.mode,remote.mode)) return null;
  return {left:local.id,right:remote.id,other};
}

export function bridgeState(lab, vlan) {
  const nodes=lab.devices.filter(d=>d.type==='switch'&&vlanExists(d,vlan));
  const compare=(a,b)=>(a.stp?.vlans?.[vlan]?.priority??32768)-(b.stp?.vlans?.[vlan]?.priority??32768)||a.id.localeCompare(b.id,undefined,{numeric:true});
  const state=new Map(nodes.map(d=>[d.id,{root:d,ports:{}}]));
  const links=new Map();
  const edges=new Map(nodes.map(d=>[d.id,[]]));
  const portKey=(d,name)=>d.id+':'+name;
  for (const {a,b} of lab.links) {
    const left=deviceById(lab,a.device), right=deviceById(lab,b.device);
    if (!state.has(left.id)||!state.has(right.id)||!linkUp(lab,left,a.port)) continue;
    const x=left.ports[a.port],y=right.ports[b.port];
    if ((x.bpduguard??left.stp?.guard)&&(x.portfast??left.stp?.portfast)) {state.get(left.id).ports[a.port]='err-disabled';continue;}
    if ((y.bpduguard??right.stp?.guard)&&(y.portfast??right.stp?.portfast)) {state.get(right.id).ports[b.port]='err-disabled';continue;}
    const xx=vlanEgress(x,vlan), yy=vlanEgress(y,vlan);
    if (xx===undefined||yy===undefined||vlanIngress(y,xx)!==vlan||vlanIngress(x,yy)!==vlan) continue;
    const group=bundle(lab,left,a.port,b);
    if ((x.channel||y.channel)&&!group) {
      state.get(left.id).ports[a.port]='suspended';
      state.get(right.id).ports[b.port]='suspended';
      continue;
    }
    const key=group?[portKey(left,group.left),portKey(right,group.right)].sort().join('-'):portKey(left,a.port);
    if (links.has(key)) {links.get(key).members.push({a,b});continue;}
    const edge={left,right,a,b,members:[{a,b}]};
    links.set(key,edge);edges.get(left.id).push(edge);edges.get(right.id).push(edge);
  }
  const unvisited=new Set(nodes.map(d=>d.id));
  for (const root of nodes.sort(compare)) {
    if (!unvisited.has(root.id)) continue;
    const paths=new Map([[root.id,{device:root,cost:0}]]);
    const side=(edge,d)=>edge.left===d?edge.a:edge.b;
    while (true) {
      const row=[...paths.values()].filter(entry=>unvisited.has(entry.device.id)).sort((a,b)=>a.cost-b.cost||compare(a.device,b.device))[0];
      if (!row) break;
      const {device,cost}=row;
      unvisited.delete(device.id);
      state.get(device.id).root=root;
      for (const edge of edges.get(device.id)) {
        const other=edge.left===device?edge.right:edge.left;
        if (!unvisited.has(other.id)) continue;
        const port=other.ports[side(edge,other).port];
        const next=cost+(port.stp?.[vlan]?.cost??port.stp?.all?.cost??(port.speed==='100'?19:port.speed==='10'?100:4));
        const current=paths.get(other.id);
        if (!current||next<current.cost||(next===current.cost&&compare(device,current.via)<0)) paths.set(other.id,{device:other,cost:next,via:device,edge});
      }
    }
    for (const [id,row] of paths) {
      for (const edge of edges.get(id)) {
        const other=edge.left===row.device?edge.right:edge.left;
        const far=paths.get(other.id);
        const role=row.edge===edge?'Root':far.edge===edge||row.cost<far.cost||(row.cost===far.cost&&compare(row.device,other)<0)?'Desg':'Altn';
        for (const member of edge.members) {
          const end=member.a.device===id?member.a:member.b;
          state.get(id).ports[end.port]=role;
        }
      }
    }
  }
  return state;
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
    if (no) {delete setting.channel;return '';}
    if (!number(words[1],1,48))return 'Use channel group 1–48.';
    const id=Number(words[1]);
    const mode=words[3];
    if(Object.entries(d.ports).some(([name,p])=>name!==port&&p.channel?.id===id&&p.channel.mode!==mode))return 'Group members must use the same channel mode.';
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
    d.stp.vlans[vlan]={priority:field==='root'?(value==='primary'?24576:28672):Number(value)};
    return '';
  }
  return 'Check the spanning-tree configuration arguments.';
}

export function switchingShow(lab,device,args) {
  if (args[1]==='spanning-tree') {
    const id=args[2]==='vlan'?Number(args[3]):null;
    const vlans=id?[id]:Object.keys(device.vlans).map(Number);
    return vlans.flatMap(vlan=>{
      const row=bridgeState(lab,vlan).get(device.id);
      if(!row)return [];
      const ports=models.switch.ports.filter(port=>linkUp(lab,device,port)&&vlanEgress(device.ports[port],vlan)!==undefined);
      return [`VLAN${String(vlan).padStart(4,'0')}  Root: ${row.root.name}  Mode: ${device.stp?.mode??'pvst'}`,
        ...ports.map(port=>{const role=row.ports[port]??'Desg';return '  '+port+'  '+role+'  '+(role==='Altn'?'BLK':['suspended','err-disabled'].includes(role)?'DOWN':'FWD');})];
    }).join('\n')||'No active spanning-tree instances.';
  }
  if (args[1]==='etherchannel') {
    const groups=Object.entries(device.ports).filter(([,p])=>p.channel&&(!args[2]||args[2]==='summary'||p.channel.id===Number(args[2])));
    return groups.map(([port,p])=>'Po'+p.channel.id+'  '+p.channel.mode+'  '+port+'  '+(bundle(lab,device,port)&&linkUp(lab,device,port)?'bundled':'standalone / suspended')).join('\n')||'No EtherChannel groups.';
  }
  const name=args.length>2?args.slice(3).join(''):null;
  return Object.entries(device.ports).filter(([port,p])=>p.security&&(!name||port.toLowerCase()===name.toLowerCase()))
    .map(([port,p])=>`${port}  ${p.security.disabled?'secure-shutdown':p.security.enabled?'secure-up':'disabled'}  Maximum ${p.security.maximum??1}  Violations ${p.security.violations??0}`).join('\n')||'No port-security entries.';
}
