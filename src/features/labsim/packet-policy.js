import { allowsTraffic, parseRule } from './acl.js';
import { inSubnet } from './network.js';
import { matchesV6 } from './ipv6.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';
import { deviceClock } from './device-files.js';

const timing=['monday','tuesday','wednesday','thursday','friday','saturday','sunday','daily','weekdays','weekend'];
export const packetPolicyIOS={
  operational:['show ipv6 access-list [<name>]','show time-range [<name>]','show ip traffic','show ipv6 traffic'],
  global:['ipv6 access-list <name>','no ipv6 access-list <name>','time-range <name>','no time-range <name>',
    'ip access-list resequence <name> <start> <increment>','ipv6 access-list resequence <name> <start> <increment>'],
  interface:['ipv6 traffic-filter <name> in','ipv6 traffic-filter <name> out','no ipv6 traffic-filter <name> in','no ipv6 traffic-filter <name> out',
    ...['ip','ipv6'].flatMap(af=>['rx','any'].flatMap(direction=>[
      af+' verify unicast source reachable-via '+direction+' [allow-default]',
      'no '+af+' verify unicast source reachable-via '+direction+' [allow-default]'
    ]))],
  acl6:['permit <rule...>','deny <rule...>','remark <text...>','sequence <number> <rule...>','no sequence <number>'],
  timeRange:[...timing.map(day=>'periodic '+day+' <start> to <end>'),'no periodic']
};

const minute=raw=>{
  const [hours,mins,extra]=raw?.split(':')??[];
  return !extra&&integer(hours,0,23)&&/^\d{2}$/.test(mins??'')&&Number(mins)<=59?Number(hours)*60+Number(mins):null;
};
const weekdays=[1,2,3,4,5],weekend=[0,6];
const dayIndex=label=>objDays[label]??[];
const objDays=Object.fromEntries(timing.map((label,index)=>[label,index<7?[(index+1)%7]:
  label==='daily'?[0,1,2,3,4,5,6]:label==='weekdays'?weekdays:weekend]));
export function permittedAt(d,name,date=Date.now()) {
  if(!name)return true;
  const {now,offset}=deviceClock(d,date);
  const current=new Date(now+offset*60000);
  const profile=own(d.timeRanges,name),min=current.getUTCHours()*60+current.getUTCMinutes(),day=current.getUTCDay();
  return profile?.periodic.some(range=>range.start<range.end?dayIndex(range.day).includes(day)&&min>=range.start&&min<range.end:
    dayIndex(range.day).includes(day)&&min>=range.start||dayIndex(range.day).includes((day+6)%7)&&min<range.end)??false;
}

export function packetPolicyPort(d,p,args) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [family,verb,list,dir]=w;
  if(!['ip','ipv6'].includes(family))return null;
  if(verb==='traffic-filter'){
    if(!keyName(list))return invalid('Use a valid IPv6 ACL name.');
    p.acl6??={};
    if(no){if(p.acl6[dir]===list)delete p.acl6[dir];}else p.acl6[dir]=list;
    return reply();
  }
  if(verb==='verify'){
    p.urpf??={};
    if(no)delete p.urpf[family];
    else p.urpf[family]={mode:w[5],allowDefault:w.includes('allow-default')};
    return reply();
  }
  return null;
}

export function passesUrpf(d,port,family,source,rib,record) {
  const settings=d.ports[port]?.urpf?.[family];
  if(!settings)return true;
  const match=family==='ip'?inSubnet:matchesV6;
  const route=rib().find(row=>(row.prefix!==0||settings.allowDefault)&&match(source,row.destination,row.prefix));
  if(route&&(settings.mode==='any'||route.port===port))return true;
  if(record){
    const counts=d.urpfDrops??={};
    counts[family]=(counts[family]??0)+1;
  }
  return false;
}

export function passesV6Acl(d,port,direction,src,dst,packet,record) {
  return allowsTraffic(d,d.ports[port]?.acl6?.[direction],src,dst,packet,record,true,'ipv6');
}

function aclRows(d,name,list) {
  return ['IPv6 access list '+name,...list.rules.map(rule=>
    '  sequence '+rule.sequence+' '+rule.raw+(rule.timeRange?' ('+(permittedAt(d,rule.timeRange)?'active':'inactive')+')':'')+
    (rule.hits?' ('+rule.hits+' matches)':''))];
}

export function packetPolicyCLI(d,s,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [verb,sub,name,value,extra]=w;
  if(c.startsWith('show ipv6 access-list'))return reply(Object.entries(d.acl6??{}).filter(([key])=>!value||key===value).
    flatMap(([key,list])=>aclRows(d,key,list)).join('\n')||'No IPv6 access lists.');
  if(c.startsWith('show time-range'))return reply(Object.entries(d.timeRanges??{}).filter(([key])=>!name||key===name).
    flatMap(([key,list])=>[key+' ('+(permittedAt(d,key)?'active':'inactive')+')',...list.periodic.map(row=>'  periodic '+row.raw)]).join('\n')||'No matching time ranges.');
  if(c==='show ip traffic'||c==='show ipv6 traffic')return reply((sub==='ip'?'IPv4':'IPv6')+' source validation drops: '+(d.urpfDrops?.[sub]??0));
  if(s.mode==='global'&&['ip','ipv6'].includes(verb)&&sub==='access-list'&&name==='resequence'){
    const list=own(verb==='ip'?d.acl:d.acl6,value),step=w[5];
    if(!list||!integer(extra,1,2147483647)||!integer(step,1,2147483647)||Number(extra)+(list.rules.length-1)*Number(step)>2147483647)
      return invalid('Select an existing access list and valid sequence start and increment.');
    list.rules=list.rules.map((rule,i)=>({...rule,sequence:Number(extra)+i*Number(step)}));return reply();
  }
  if(s.mode==='global'&&verb==='ipv6'&&sub==='access-list'){
    if(!keyName(name))return invalid('Use a valid IPv6 access-list name.');
    const list=d.acl6??={};
    if(no){delete list[name];return reply();}
    list[name]??={rules:[]};
    return enter(s,'acl6',name);
  }
  if(s.mode==='acl6'){
    const list=own(d.acl6,s.current);
    if(!list)return invalid('This IPv6 access list no longer exists.');
    if(no){
      if(!integer(sub,1,2147483647))return invalid('Enter a valid ACL sequence number.');
      list.rules=list.rules.filter(row=>row.sequence!==Number(sub));return reply();
    }
    const sequence=verb==='sequence'?Number(sub):(list.rules.at(-1)?.sequence??0)+10;
    if(!integer(String(sequence),1,2147483647)||list.rules.some(row=>row.sequence===sequence))return invalid('Use a unique ACL sequence number.');
    const rule=parseRule('ipv6',verb==='sequence'?w.slice(2):w,sequence);
    if(!rule)return invalid('Check the IPv6 access-list entry.');
    list.rules=[...list.rules,rule].sort((a,b)=>a.sequence-b.sequence);return reply();
  }
  if(s.mode==='global'&&verb==='time-range'){
    if(!keyName(sub))return invalid('Use a valid schedule name.');
    const ranges=d.timeRanges??={};
    if(no){delete ranges[sub];return reply();}
    ranges[sub]??={periodic:[]};
    return enter(s,'timeRange',sub);
  }
  if(s.mode==='timeRange'){
    const profile=own(d.timeRanges,s.current);
    if(!profile)return invalid('This time range no longer exists.');
    if(no){profile.periodic=[];return reply();}
    const start=minute(name),end=minute(extra);
    if(start===null||end===null||start===end)return invalid('Enter different start and end times in hh:mm format.');
    const raw=w.slice(1).join(' ');
    if(!profile.periodic.some(r=>r.raw===raw))profile.periodic.push({day:sub,start,end,raw});
    return reply();
  }
  return null;
}

export function packetPolicyRunning(d) {
  return [
    ...Object.entries(d.timeRanges??{}).flatMap(([name,row])=>['time-range '+name,...row.periodic.map(r=>' periodic '+r.raw)]),
    ...Object.entries(d.acl6??{}).flatMap(([name,list])=>['ipv6 access-list '+name,
      ...list.rules.map(r=>' sequence '+r.sequence+' '+r.raw)])
  ];
}
export function packetPolicyPortLines(p) {
  return [
    ...Object.entries(p.acl6??{}).map(([dir,name])=>' ipv6 traffic-filter '+name+' '+dir),
    ...Object.entries(p.urpf??{}).map(([af,row])=>' '+af+' verify unicast source reachable-via '+row.mode+(row.allowDefault?' allow-default':''))
  ];
}
