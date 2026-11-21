import { inSubnet, ipv4, linkUp, segment, transaction } from './network.js';
import { interfaceName } from './ios.js';
import { enter, integer, invalid, reply } from './cli-utils.js';

const redundancySyntax=prefix=>[
  prefix+' ip <vip>','no '+prefix+' ip [<vip>]',prefix+' priority <priority>','no '+prefix+' priority',
  prefix+' preempt','no '+prefix+' preempt',prefix+' track <track> decrement <decrement>','no '+prefix+' track <track>'
];
export const availabilityIOS={
  operational:['show standby [brief]','show standby <interface...>','show vrrp [brief]','show track [<id>]',
    'show ip sla statistics [<id>]','show ip sla summary','show ip sla configuration [<id>]'],
  global:['ip sla <id>','no ip sla <id>','ip sla schedule <id> life forever start-time now','no ip sla schedule <id>',
    'track <id> ip sla <sla> reachability','track <id> interface <port...> line-protocol','no track <id>'],
  interface:[...redundancySyntax('standby [<group>]'),...redundancySyntax('vrrp <group>'),'standby version 2','standby version 1'],
  sla:['icmp-echo <address>','icmp-echo <address> source-ip <ip>','icmp-echo <address> source-interface <interface...>',
    'frequency <seconds>','timeout <ms>']
};

function slaStatus(lab,d,id) {
  const sla=d.sla?.[id];
  if(!sla?.active||!sla.destination)return {up:false,status:'Inactive'};
  const source=sla.interface?d.ports[sla.interface]?.address:sla.source;
  if(sla.interface&&!linkUp(lab,d,sla.interface)||source&&!Object.entries(d.ports).some(([port,p])=>p.address===source&&!p.vrf&&linkUp(lab,d,port)))return {up:false,status:'No source address'};
  const hit=transaction(lab,d,sla.destination,{sourceAddress:source,baseOnly:true});
  return {up:hit.ok,status:hit.ok?'OK':'Timeout',path:hit.path};
}

export function trackedUp(lab,d,id) {
  const entry=d.tracks?.[id];
  if(!entry)return false;
  return entry.port?linkUp(lab,d,entry.port):slaStatus(lab,d,entry.sla).up;
}

export function availabilityPort(d,name,args,c) {
  const no=args[0]==='no', w=no?args.slice(1):args;
  const proto=w[0];
  if(!['standby','vrrp'].includes(proto))return null;
  const p=d.ports[name];
  if(d.type==='switch'&&p.mode!=='routed'&&!name.startsWith('Vlan'))return invalid('Use a routed interface or SVI.');
  if(proto==='standby'&&w[1]==='version'){p.hsrpVersion=Number(w[2]);return reply();}
  const explicit=/^\d+$/.test(w[1]), id=explicit?w[1]:'0';
  if(!integer(id,proto==='standby'?0:1,proto==='standby'&&p.hsrpVersion===2?4095:255))return invalid('Check the redundancy group and version.');
  const [option,value,,decrement]=w.slice(explicit?2:1);
  const groups=(p.fhrp??={})[proto]??={};
  const group=groups[id]??={};
  if(option==='ip'){
    if(no){delete groups[id];return reply();}
    if(ipv4(value)===null||p.address&&!inSubnet(value,p.address,p.prefix))return invalid('Use a virtual IP in the interface subnet.');
    group.ip=value;return reply();
  }
  if(option==='priority'){
    if(no)delete group.priority;
    else if(integer(value,proto==='standby'?0:1,proto==='standby'?255:254))group.priority=Number(value);
    else return invalid('Check the gateway priority.');
    return reply();
  }
  if(option==='preempt'){group.preempt=!no;return reply();}
  if(option==='track'&&integer(value,1,1000)){
    group.tracks??={};
    if(no)delete group.tracks[value];
    else if(integer(decrement,1,255))group.tracks[value]=Number(decrement);
    else return invalid('Use a valid priority decrement.');
    return reply();
  }
  return invalid('Check the gateway group configuration.');
}

function elections(lab,neighbors,address,track=true) {
  const groups=new Map();
  for(const neighbor of neighbors){
    const {device,port}=neighbor;
    const intf=device.ports[port];
    if(!intf?.address||!linkUp(lab,device,port))continue;
    for(const [protocol,entries] of Object.entries(intf.fhrp??{}))for(const [group,row] of Object.entries(entries)){
      if(!row.ip||address&&row.ip!==address||!inSubnet(row.ip,intf.address,intf.prefix))continue;
      const id=protocol+':'+group+':'+row.ip+':'+(protocol==='standby'?intf.hsrpVersion??1:'');
      const candidates=groups.get(id)??[];
      groups.set(id,candidates);
      const penalty=track?Object.entries(row.tracks??{}).reduce((prior,[id,decrement])=>prior+(trackedUp(lab,device,id)?0:decrement),0):0;
      const priority=protocol==='vrrp'&&row.ip===intf.address?255:Math.max(0,(row.priority??100)-penalty);
      candidates.push({...neighbor,protocol,group,row,priority,address:intf.address,id});
    }
  }
  return groups;
}

function winner(candidates,remember) {
  const order=candidates.toSorted((a,b)=>b.priority-a.priority||ipv4(b.address)-ipv4(a.address));
  const candidate=order[0];
  const newest=Math.max(0,...order.map(item=>item.row.epoch??0));
  const voting=order.find(item=>item.row.epoch===newest);
  const incumbent=order.find(item=>item.device.id===voting?.row.active);
  const active=incumbent?.priority>0&&!(candidate.priority>incumbent.priority&&(candidate.row.preempt??candidate.protocol==='vrrp'))?incumbent:candidate;
  if(!active||!active.priority)return null;
  if(remember)for(const item of order)Object.assign(item.row,{active:active.device.id,epoch:newest+Number(active!==incumbent)});
  return active;
}

export function virtualGateway(lab,neighbors,address,track=true) {
  for(const entries of elections(lab,neighbors,address,track).values()){
    const hit=winner(entries,track);
    if(hit)return {...hit,virtual:true};
  }
  return null;
}

export function availabilityCLI(lab,d,s,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(c.startsWith('show track')){
    const rows=Object.entries(d.tracks??{}).filter(([id])=>!args[2]||id===args[2]);
    return reply(rows.map(([id,t])=>'Track '+id+' '+(t.port?t.port+' line-protocol':'IP SLA '+t.sla+' reachability')+
      '\n  Reachability is '+(trackedUp(lab,d,id)?'Up':'Down')).join('\n')||'No matching track objects.');
  }
  if(c.startsWith('show ip sla ')){
    const rows=Object.entries(d.sla??{}).filter(([id])=>!args[4]||id===args[4]);
    return reply(rows.map(([id,sla])=>{
      if(args[3]==='configuration')return 'IP SLA '+id+' ICMP Echo to '+(sla.destination??'unconfigured')+
        '\n  Source: '+(sla.source??sla.interface??'auto')+'  Frequency: '+(sla.frequency??60)+' seconds  Timeout: '+(sla.timeout??5000)+' ms';
      return 'IP SLA '+id+' → '+(sla.destination??'unconfigured')+'  Latest operation return code: '+slaStatus(lab,d,id).status;
    }).join('\n')||'No matching IP SLA operations.');
  }
  if(args[0]==='show'&&['standby','vrrp'].includes(args[1])){
    const filter=args[2]&&args[2]!=='brief'?interfaceName(args.slice(2)):null;
    const rows=Object.keys(d.ports).filter(port=>!filter||filter===port).flatMap(port=>{
      const members=[{device:d,port},...segment(lab,d,port,false,'control')];
      return [...elections(lab,members).values()].flatMap(entries=>{
        const local=entries.find(e=>e.device===d&&e.port===port&&e.protocol===args[1]);
        if(!local)return [];
        const active=winner(entries,true);
        const role=active?(active.device===d?(local.protocol==='standby'?'Active':'Master'):(local.protocol==='standby'?'Standby':'Backup')):'Init';
        return [port+'  '+local.group+'  '+role+'  priority '+local.priority+'  virtual '+local.row.ip+'  active '+(active?.device.name??'—')];
      });
    });
    return reply(rows.length?['Interface  Group  State  Priority  Virtual IP  Active device',...rows].join('\n'):'No active gateway groups.');
  }
  if(s.mode==='global'&&w[0]==='track'){
    if(!integer(w[1],1,1000))return invalid('Use a track ID 1–1000.');
    const tracked=d.tracks??={};
    if(no){delete tracked[w[1]];return reply();}
    if(w[2]==='interface'){
      const port=interfaceName(w.slice(3,-1));
      if(!d.ports[port])return invalid('Select an existing interface.');
      tracked[w[1]]={port};return reply();
    }
    if(!integer(w[4],1,2147483647))return invalid('Use a valid SLA operation ID.');
    tracked[w[1]]={sla:w[4]};return reply();
  }
  if(s.mode==='global'&&w[0]==='ip'&&w[1]==='sla'){
    const id=w[2]==='schedule'?w[3]:w[2];
    if(!integer(id,1,2147483647))return invalid('Use a valid SLA operation ID.');
    const table=d.sla??={};
    if(w[2]==='schedule'){
      if(!table[id]?.destination)return invalid('Configure the ICMP echo operation first.');
      table[id].active=!no;return reply();
    }
    if(no){delete table[id];return reply();}
    table[id]??={};return enter(s,'sla',id);
  }
  if(s.mode==='sla'){
    const row=d.sla?.[s.current];
    if(!row)return invalid('This IP SLA operation no longer exists.');
    if(w[0]==='icmp-echo'){
      const port=w[2]==='source-interface'?interfaceName(w.slice(3)):undefined;
      if(ipv4(w[1])===null||w[2]==='source-ip'&&ipv4(w[3])===null||w[2]==='source-interface'&&!d.ports[port])return invalid('Check the ICMP destination and source.');
      row.destination=w[1];row.source=w[2]==='source-ip'?w[3]:undefined;row.interface=port;
      return reply();
    }
    if(w[0]==='frequency'&&integer(w[1],1,604800)||w[0]==='timeout'&&integer(w[1],1,604800000)){
      row[w[0]]=Number(w[1]);return reply();
    }
    return invalid('Check the IP SLA operation settings.');
  }
  return null;
}

export function availabilityRunning(d) {
  return [
    ...Object.entries(d.sla??{}).flatMap(([id,row])=>[
      'ip sla '+id,...(row.destination?[' icmp-echo '+row.destination+(row.source?' source-ip '+row.source:row.interface?' source-interface '+row.interface:'')]:[]),
      ...(row.frequency?[' frequency '+row.frequency]:[]),...(row.timeout?[' timeout '+row.timeout]:[]),
      ...(row.active?['ip sla schedule '+id+' life forever start-time now']:[])
    ]),
    ...Object.entries(d.tracks??{}).map(([id,row])=>'track '+id+(row.port?' interface '+row.port+' line-protocol':' ip sla '+row.sla+' reachability'))
  ];
}

export function gatewayRunning(p) {
  return [
    ...(p.hsrpVersion?[' standby version '+p.hsrpVersion]:[]),
    ...Object.entries(p.fhrp??{}).flatMap(([proto,groups])=>Object.entries(groups).flatMap(([group,row])=>{
      const start=' '+proto+' '+group+' ';
      return [...(row.ip?[start+'ip '+row.ip]:[]),...(row.priority!==undefined?[start+'priority '+row.priority]:[]),
        ...(row.preempt===undefined?[]:[(row.preempt?start:' no'+start)+'preempt']),
        ...Object.entries(row.tracks??{}).map(([track,decrement])=>start+'track '+track+' decrement '+decrement)];
    }))
  ];
}
