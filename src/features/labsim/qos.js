import { allowsTraffic } from './acl.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';
import { interfaceName } from './ios.js';

const actionSyntax=[
  'set dscp <value>','no set dscp','priority','priority <kbps>','priority percent <percent>','priority level <level>',
  'no priority','bandwidth percent <percent>','no bandwidth','fair-queue','no fair-queue',
  'police <bps> [<burst>]','police <bps> conform-action transmit exceed-action drop','no police',
  'shape average <bps>','no shape average','service-policy <name>','no service-policy'
];
const attachment=['service-policy input <name>','service-policy output <name>','no service-policy input [<name>]','no service-policy output [<name>]'];
export const qosIOS={
  operational:['show class-map [<name>]','show policy-map [<name>]','show policy-map interface [<interface...>]',
    'show policy-map control-plane [input]','show policy-map control-plane output'],
  global:['class-map [match-any] <name>','class-map match-all <name>','no class-map <name>',
    'policy-map <name>','no policy-map <name>','control-plane'],
  interface:attachment,
  qosClassMap:['match dscp <values...>','no match dscp','match ip dscp <values...>','no match ip dscp',
    'match access-group name <name>','match access-group <number>','no match access-group [name <name>]','match protocol <name>','no match protocol <name>'],
  qosPolicy:['class <name>','no class <name>'],
  qosClass:actionSyntax,
  qosControl:attachment
};

const dscpNames={
  default:0,ef:46,cs0:0,cs1:8,cs2:16,cs3:24,cs4:32,cs5:40,cs6:48,cs7:56,
  af11:10,af12:12,af13:14,af21:18,af22:20,af23:22,af31:26,af32:28,af33:30,af41:34,af42:36,af43:38
};
export const dscpValue=value=>integer(value,0,63)?Number(value):own(dscpNames,value?.toLowerCase());
const store=d=>d.qos??={classes:{},policies:{},control:{}};
function attachmentCommand(d,holder,args) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(no){if(!w[2]||holder[w[1]]===w[2])delete holder[w[1]];return reply();}
  if(!own(d.qos?.policies,w[2]))return invalid('Create the service policy first.');
  holder[w[1]]=w[2];return reply();
}

export function qosPort(d,p,args) {
  if(!/^(?:no )?service-policy (?:input|output)\b/.test(args.join(' ')))return null;
  return attachmentCommand(d,p.servicePolicies??={},args);
}

function actionRows(cfg) {
  return [
    ...(cfg.dscp!==undefined?['set dscp '+(cfg.mark??cfg.dscp)]:[]),
    ...(cfg.priority?['priority'+(cfg.priority.length?' '+cfg.priority.join(' '):'')]:[]),
    ...(cfg.bandwidth?['bandwidth percent '+cfg.bandwidth]:[]),
    ...(cfg.fair?['fair-queue']:[]),
    ...(cfg.police?['police '+cfg.police.rate+(cfg.police.burst?' '+cfg.police.burst:'')+' conform-action transmit exceed-action drop']:[]),
    ...(cfg.shape?['shape average '+cfg.shape]:[]),
    ...(cfg.child?['service-policy '+cfg.child]:[])
  ];
}
function classRows(cfg) {
  return cfg.matches.map(row=>row.kind==='dscp'?'match dscp '+row.raw.join(' '):
    row.kind==='access'?'match access-group '+(row.named?'name ':'')+row.name:'match protocol '+row.name);
}

export function qosRunning(d) {
  const data=d.qos;
  if(!data)return [];
  return [
    ...Object.entries(data.classes).flatMap(([key,value])=>['class-map match-'+value.mode+' '+key,...classRows(value).map(r=>' '+r)]),
    ...Object.entries(data.policies).flatMap(([name,map])=>['policy-map '+name,...Object.entries(map).flatMap(([key,value])=>[' class '+key,...actionRows(value).map(action=>'  '+action)])]),
    ...(Object.keys(data.control).length?['control-plane',...Object.entries(data.control).map(([dir,name])=>' service-policy '+dir+' '+name)]:[])
  ];
}

function showAttached(d,port,holder,filter) {
  return Object.entries(holder??{}).filter(([dir])=>!filter||dir===filter).flatMap(([direction,name])=>{
    const cfg=own(d.qos?.policies,name);
    if(!cfg)return [];
    const counters=own(d.qos?.stats,JSON.stringify([port,direction,name]));
    return [port+'  Service-policy '+direction+': '+name,...Object.entries(cfg).flatMap(([key,conf])=>{
      const row=own(counters,key)??{};
      return ['  Class-map: '+key+' · '+(row.packets??0)+' packets, '+(row.bytes??0)+' bytes',
        '    Marked '+(row.marked??0)+' · Dropped '+(row.dropped??0)+' · Queued '+(row.queued??0),
        ...actionRows(conf).map(item=>'    '+item)];
    })];
  });
}

export function qosCLI(d,s,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [verb,field,value,extra]=w;
  if(c.startsWith('show class-map'))return reply(Object.entries(d.qos?.classes??{}).filter(([key])=>!value||key===value).
    flatMap(([key,cfg])=>['Class Map match-'+cfg.mode+' '+key,...classRows(cfg)]).join('\n')||'No matching class maps.');
  if(c.startsWith('show policy-map')){
    if(value==='interface'){
      const name=extra?interfaceName(w.slice(3)):null;
      if(extra&&!name)return invalid('Select an interface.');
      const ports=Object.entries(d.ports).filter(([key])=>!name||name===key);
      return reply(ports.flatMap(([key,p])=>showAttached(d,key,p.servicePolicies)).join('\n')||'No interface service policies.');
    }
    if(value==='control-plane')return reply(showAttached(d,'control-plane',d.qos?.control,extra).join('\n')||'No control-plane service policy.');
    return reply(Object.entries(d.qos?.policies??{}).filter(([key])=>!value||key===value).flatMap(([key,p])=>
      ['Policy Map '+key,...Object.entries(p).flatMap(([name,cfg])=>['  Class '+name,...actionRows(cfg).map(line=>'    '+line)])]).join('\n')||'No matching policy maps.');
  }
  if(s.mode==='global'&&(verb==='class-map'||verb==='policy-map')){
    const key=w.at(-1);
    if(!keyName(key)||key==='class-default')return invalid('Use a valid unique map name.');
    const table=verb==='class-map'?store(d).classes:store(d).policies;
    if(no){delete table[key];return reply();}
    table[key]??=verb==='class-map'?{mode:field==='match-any'?'any':'all',matches:[]}:{};
    return enter(s,verb==='class-map'?'qosClassMap':'qosPolicy',key);
  }
  if(s.mode==='global'&&verb==='control-plane'){store(d);return enter(s,'qosControl',null);}
  if(s.mode==='qosControl')return attachmentCommand(d,store(d).control,args);
  if(s.mode==='qosClassMap'){
    const cfg=own(d.qos?.classes,s.current);
    if(!cfg)return invalid('The class map no longer exists.');
    const kind=field==='access-group'?'access':field==='protocol'?'protocol':'dscp';
    if(no){cfg.matches=cfg.matches.filter(row=>row.kind!==kind||(kind==='protocol'&&row.name!==value));return reply();}
    if(kind==='dscp'){
      const values=w.slice(field==='ip'?3:2);
      if(!values.length||values.some(value=>dscpValue(value)===undefined))return invalid('Use a DSCP name or value from 0 to 63.');
      cfg.matches.push({kind,values:values.map(dscpValue),raw:values});return reply();
    }
    const name=kind==='access'&&value==='name'?extra:value;
    if(kind==='access'&&!keyName(name)||kind==='protocol'&&!['icmp','tcp','udp','http','https','dns','ssh','sip'].includes(name))
      return invalid('Check the access group or protocol.');
    cfg.matches.push({kind,name,named:kind==='access'&&value==='name'});return reply();
  }
  if(s.mode==='qosPolicy'){
    const map=own(d.qos?.policies,s.current);
    if(!map)return invalid('The service policy no longer exists.');
    if(field!=='class-default'&&!own(d.qos.classes,field)&&!no)return invalid('Create the named class map first.');
    if(no){delete map[field];return reply();}
    map[field]??={};
    return enter(s,'qosClass',{name:s.current,class:field},true);
  }
  if(s.mode==='qosClass'){
    const cfg=own(own(d.qos?.policies,s.current.name),s.current.class);
    if(!cfg)return invalid('The configured class no longer exists.');
    if(verb==='set'){
      if(no){delete cfg.dscp;delete cfg.mark;return reply();}
      const dscp=dscpValue(value);
      if(dscp===undefined)return invalid('Use a DSCP name or value from 0 to 63.');
      cfg.dscp=dscp;cfg.mark=value;return reply();
    }
    const property={priority:'priority',bandwidth:'bandwidth','fair-queue':'fair',police:'police',shape:'shape','service-policy':'child'}[verb];
    if(no){delete cfg[property];return reply();}
    if(verb==='priority'&&(!field||integer(field,1,10000000)||field==='percent'&&integer(value,1,100)||field==='level'&&integer(value,1,2))){cfg.priority=w.slice(1);return reply();}
    if(verb==='bandwidth'&&integer(value,1,100)){cfg.bandwidth=Number(value);return reply();}
    if(verb==='fair-queue'){cfg.fair=true;return reply();}
    if(verb==='police'&&integer(field,8,4294967295)&&(!value||value==='conform-action'||integer(value,1,10000000))){
      cfg.police={rate:Number(field),burst:Number(value)||undefined};return reply();
    }
    if(verb==='shape'&&integer(value,8,4294967295)){cfg.shape=Number(value);return reply();}
    if(verb==='service-policy'&&field!==s.current.name&&own(d.qos.policies,field)){
      cfg.child=field;return reply();
    }
    return invalid('Check the class action and argument range.');
  }
  return null;
}

const layer7={http:['tcp',80],https:['tcp',443],ssh:['tcp',22],dns:['udp',53],sip:['udp',5060]};
function classified(d,cfg,packet,source,target) {
  const checks=cfg.matches.map(row=>{
    if(row.kind==='dscp')return row.values.includes(packet.dscp??0);
    if(row.kind==='access')return allowsTraffic(d,row.name,source,target,packet,false);
    const protocol=layer7[row.name];
    return protocol?packet.protocol===protocol[0]&&[packet.destinationPort,packet.sourcePort].includes(protocol[1]):packet.protocol===row.name;
  });
  return checks.length>0&&(cfg.mode==='all'?checks.every(Boolean):checks.some(Boolean));
}

export function servicePolicy(d,port,direction,packet,source,target,offered,record) {
  const name=port==='control-plane'?d.qos?.control[direction]:d.ports[port]?.servicePolicies?.[direction];
  if(!name)return offered;
  const apply=(policy,count,seen)=>{
    const map=own(d.qos?.policies,policy);
    if(!map||seen.includes(policy))return count;
    const match=Object.keys(map).find(key=>{
      const group=own(d.qos.classes,key);return group&&classified(d,group,packet,source,target);
    })??'class-default';
    const cfg=own(map,match);
    if(!cfg)return count;
    const size=packet.bytes??84;
    const limit=cfg.police?Math.floor((cfg.police.rate/8+(cfg.police.burst??0))/size):count;
    const after=Math.min(count,limit);
    const marked=cfg.dscp!==undefined&&packet.dscp!==cfg.dscp?after:0;
    const queued=cfg.shape?Math.max(0,after-Math.floor(cfg.shape/(8*size))):0;
    if(cfg.dscp!==undefined)packet.dscp=cfg.dscp;
    if(record){
      const table=d.qos.stats??={};
      const id=JSON.stringify([port,direction,policy]);
      const key=table[id]??={};
      const row=key[match]??={packets:0,bytes:0,marked:0,dropped:0,queued:0};
      row.packets+=count;row.bytes+=count*size;row.marked+=marked;row.dropped+=count-after;row.queued+=queued;
    }
    return after&&cfg.child?apply(cfg.child,after,[...seen,policy]):after;
  };
  return apply(name,offered,[]);
}
