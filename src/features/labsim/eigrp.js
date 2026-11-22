import { forwardsIpv4, dotted, ipv4, linkUp, networkAddress, segment } from './network.js';
import { interfaceName } from './ios.js';
import { applyPolicy, prefixPermits, routeKey } from './route-policy.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const metrics='<bandwidth> <delay> <reliability> <load> <mtu>';
const topology=[
  'redistribute connected [metric '+metrics+'] [route-map <map>]',
  'redistribute static [metric '+metrics+'] [route-map <map>]',
  'redistribute ospf <process> [metric '+metrics+'] [route-map <map>]',
  'no redistribute connected','no redistribute static','no redistribute ospf <process>',
  'default-metric '+metrics,'no default-metric','distribute-list prefix <name> in','distribute-list prefix <name> out',
  'no distribute-list prefix <name> in','no distribute-list prefix <name> out'
];
const processCommands=[
  'network <network> [<wildcard>]','no network <network> [<wildcard>]',
  'eigrp router-id <address>','eigrp stub [connected] [summary] [static]','eigrp stub receive-only','no eigrp stub',
  'passive-interface <interface...>','no passive-interface <interface...>','passive-interface default','no passive-interface default',
  'metric weights 0 <k1> <k2> <k3> <k4> <k5>'
];
const authentication=[
  'ip authentication mode eigrp <asn> md5','no ip authentication mode eigrp <asn> md5',
  'ip authentication key-chain eigrp <asn> <name>','no ip authentication key-chain eigrp <asn> <name>',
  'ip hello-interval eigrp <asn> <seconds>','ip hold-time eigrp <asn> <seconds>','ip split-horizon eigrp <asn>','no ip split-horizon eigrp <asn>'
];
export const eigrpIOS={
  operational:['show ip eigrp neighbors [detail]','show ip eigrp interfaces [detail]',
    'show ip eigrp topology [all-links]','show ip eigrp topology <network/length>','show ip route eigrp'],
  global:['router eigrp <number-or-name>','no router eigrp <number-or-name>','key chain <name>','no key chain <name>'],
  interface:[...authentication,'delay <value>'],
  eigrp:[...processCommands,...topology,'no auto-summary','auto-summary'],
  eigrpNamed:['address-family ipv4 [unicast] autonomous-system <asn>'],
  eigrpAf:[...processCommands,'af-interface <interface...>','topology base','shutdown','no shutdown','exit-address-family'],
  eigrpInterface:['passive-interface','no passive-interface','shutdown','no shutdown','hello-interval <seconds>','hold-time <seconds>',
    'authentication mode md5','no authentication mode md5','authentication key-chain <name>','no authentication key-chain <name>','exit-af-interface'],
  eigrpTopology:[...topology,'exit-af-topology'],
  keyChain:['key <number>','no key <number>'],
  keyChainKey:['key-string <value>','no key-string','cryptographic-algorithm hmac-sha-256','cryptographic-algorithm md5']
};

const classful=address=>Number(address.split('.')[0])<128?8:Number(address.split('.')[0])<192?16:24;
const classWildcard=address=>dotted((2**(32-classful(address))-1)>>>0);
const defaults=()=>({networks:[],passive:{},afInterfaces:{},redistribute:{}});

export function eigrpPort(d,p,args) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(w[0]==='delay'){
    if(!integer(w[1],1,16777215))return invalid('Use delay in tens of microseconds.');
    p.delay=Number(w[1]);return reply();
  }
  if(w[0]==='ip'&&w[1]==='split-horizon'){
    if(!integer(w[3],1,65535))return invalid('Use a valid EIGRP ASN.');
    (p.eigrpSplit??={})[w[3]]=!no;return reply();
  }
  if(w[0]!=='ip'||!['authentication','hello-interval','hold-time'].includes(w[1]))return null;
  const authentication=w[1]==='authentication', raw=authentication?w[4]:w[3];
  if(!integer(raw,1,65535))return invalid('Select an EIGRP AS from 1 to 65535.');
  const config=(p.eigrp??={})[raw]??={};
  if(authentication){
    const key=w[2]==='mode'?'auth':'keyChain';
    if(no)delete config[key];
    else if(key==='auth'||keyName(w[5]))config[key]=w[5];else return invalid('Choose a valid key chain.');
    return reply();
  }
  if(!integer(w[4],1,65535))return invalid('Choose a valid hello or hold interval.');
  config[w[1]==='hello-interval'?'hello':'hold']=Number(w[4]);return reply();
}

export function eigrpConfig(d,s,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [verb,sub,value,option]=w;
  if(s.mode==='global'&&verb==='key'&&sub==='chain'){
    if(!keyName(value))return invalid('Choose a valid key chain name.');
    const chains=d.keyChains??={};
    if(no){delete chains[value];return reply();}
    chains[value]??={};return enter(s,'keyChain',value);
  }
  if(s.mode==='keyChain'){
    if(!integer(sub,0,2147483647))return invalid('Enter a valid key identifier.');
    const chain=own(d.keyChains,s.current);
    if(!chain)return invalid('This key chain no longer exists.');
    if(no){delete chain[sub];return reply();}
    chain[sub]??={};
    return enter(s,'keyChainKey',{name:s.current,id:sub},true);
  }
  if(s.mode==='keyChainKey'){
    const key=own(d.keyChains,s.current.name)?.[s.current.id];
    if(!key)return invalid('This key no longer exists.');
    if(verb==='cryptographic-algorithm')key.algorithm=sub;
    else if(no)delete key.value;else key.value=sub;
    return reply();
  }
  if(s.mode==='global'&&verb==='router'&&sub==='eigrp'){
    const named=!/^\d+$/.test(value);
    if(named?!keyName(value):!integer(value,1,65535))return invalid('Use an EIGRP name or an AS from 1 to 65535.');
    if(no){if(String(d.eigrp?.name??d.eigrp?.asn)===value)delete d.eigrp;return reply();}
    if(d.eigrp&&String(d.eigrp.name??d.eigrp.asn)!==value)return invalid('One EIGRP process per device is modeled.');
    d.eigrp??={...defaults(),...(named?{name:value}:{asn:Number(value)})};
    return enter(s,named?'eigrpNamed':'eigrp',value);
  }
  if(!s.mode.startsWith('eigrp'))return null;
  const cfg=d.eigrp;
  if(!cfg)return invalid('This EIGRP process no longer exists.');
  if(s.mode==='eigrpNamed'){
    const asn=w.at(-1);
    if(!integer(asn,1,65535))return invalid('Use an EIGRP AS from 1 to 65535.');
    cfg.asn=Number(asn);
    return enter(s,'eigrpAf',cfg.asn,true);
  }
  if(c==='exit-address-family'||c==='exit-af-interface'||c==='exit-af-topology'){
    const parent=s.parents?.pop();
    return enter(s,parent?.mode??'global',parent?.current);
  }
  if(s.mode==='eigrpInterface'){
    const port=cfg.afInterfaces[s.current];
    if(verb==='passive-interface'){port.passive=!no;return reply();}
    if(verb==='shutdown'){port.shutdown=!no;return reply();}
    if(['hello-interval','hold-time'].includes(verb)&&integer(sub,1,65535)){port[verb==='hello-interval'?'hello':'hold']=Number(sub);return reply();}
    if(verb==='authentication'){
      const key=sub==='mode'?'auth':'keyChain';
      if(no)delete port[key];else if(sub==='mode'||keyName(value))port[key]=value;else return invalid('Choose a valid key chain.');
      return reply();
    }
    return invalid('Check the EIGRP interface settings.');
  }
  if(verb==='af-interface'){
    const port=sub==='default'?'default':interfaceName(w.slice(1));
    if(port==='default'||d.ports[port]){cfg.afInterfaces[port]??={};return enter(s,'eigrpInterface',port,true);}
    return invalid('Select an existing interface.');
  }
  if(verb==='topology')return enter(s,'eigrpTopology',cfg.asn,true);
  if(verb==='shutdown'){cfg.shutdown=!no;return reply();}
  if(verb==='network'&&ipv4(sub)!==null&&(!value||ipv4(value)!==null)){
    const wildcard=value??classWildcard(sub);
    cfg.networks=cfg.networks.filter(r=>r.address!==sub||r.wildcard!==wildcard);
    if(!no)cfg.networks.push({address:sub,wildcard});
    return reply();
  }
  if(verb==='passive-interface'){
    if(sub==='default'){cfg.passiveDefault=!no;return reply();}
    const port=interfaceName(w.slice(1));
    if(!d.ports[port])return invalid('Select an existing interface.');
    cfg.passive[port]=!no;return reply();
  }
  if(verb==='eigrp'){
    if(sub==='router-id'&&ipv4(value)!==null){cfg.routerId=value;return reply();}
    if(sub==='stub'){cfg.stub=no?undefined:w.slice(2).length?w.slice(2):['connected','summary'];return reply();}
    return invalid('Check the EIGRP process settings.');
  }
  if(verb==='metric'&&sub==='weights'){
    if(!w.slice(3).every(k=>integer(k,0,255)))return invalid('Enter K-values from 0 to 255.');
    cfg.weights=w.slice(3).map(Number);return reply();
  }
  if(verb==='auto-summary'){cfg.autoSummary=!no;return reply();}
  if(verb==='distribute-list'){
    if(!keyName(value))return invalid('Choose a valid prefix-list name.');
    cfg.filters??={};
    if(no)delete cfg.filters[option];else cfg.filters[option]=value;
    return reply();
  }
  if(verb==='redistribute'||verb==='default-metric'){
    const start=verb==='default-metric'?1:w.indexOf('metric')+1;
    const seed=start?w.slice(start,start+5):null;
    const mapIndex=w.indexOf('route-map'), map=mapIndex<0?undefined:w[mapIndex+1];
    if(seed&&!seed.every((v,i)=>integer(v,i<2?1:0,i<2?4294967295:i<4?255:65535))||map&&!keyName(map))return invalid('Check the seed metric or route map.');
    if(verb==='default-metric'){cfg.defaultMetric=no?undefined:seed.map(Number);return reply();}
    const process=sub==='ospf'?Number(value):undefined;
    if(sub==='ospf'&&!integer(value,1,65535))return invalid('Use a valid OSPF process ID.');
    if(no)delete cfg.redistribute[sub];else cfg.redistribute[sub]={seed:seed?.map(Number),map,process};
    return reply();
  }
  return invalid('Check the EIGRP arguments.');
}

function interfaces(lab,d) {
  const cfg=d.eigrp;
  if(!cfg?.asn||cfg.shutdown||!forwardsIpv4(d))return [];
  return Object.entries(d.ports).flatMap(([port,p])=>{
    if(p.vrf||!p.address||!linkUp(lab,d,port)||!cfg.networks.some(({address,wildcard})=>((ipv4(p.address)^ipv4(address))&~ipv4(wildcard))===0))return [];
    const setting={...p.eigrp?.[cfg.asn],...cfg.afInterfaces.default,...cfg.afInterfaces[port]};
    if(setting.shutdown)return [];
    return [{...setting,port,address:p.address,prefix:p.prefix,bandwidth:p.bandwidth??1000000,delay:p.delay??(port.startsWith('Lo')?500:1),
      passive:setting.passive??cfg.passive[port]??cfg.passiveDefault??false}];
  });
}

const weights=d=>d.eigrp.weights??[1,0,1,0,0];
const authKeys=(d,config)=>Object.entries(own(d.keyChains,config.keyChain)??{}).filter(([,entry])=>entry.value);
const sameAuth=(local,remote,a,b)=>
  a.auth===b.auth&&(!a.auth||authKeys(local,a).some(([id,key])=>authKeys(remote,b).some(([other,k])=>id===other&&key.value===k.value)));

function peers(lab,d,ports) {
  return (ports.get(d.id)??[]).flatMap(local=>{
    if(local.passive||local.port.startsWith('Lo'))return [];
    return segment(lab,d,local.port,false,'control').flatMap(({device,port})=>{
      if(d.eigrp.asn!==device.eigrp?.asn||weights(d).some((value,index)=>value!==weights(device)[index]))return [];
      const remote=ports.get(device.id)?.find(p=>p.port===port);
      if(!remote||remote.passive||remote.prefix!==local.prefix||!sameAuth(d,device,local,remote)||
        networkAddress(remote.address,remote.prefix)!==networkAddress(local.address,local.prefix))return [];
      return [{device,local,remote}];
    });
  });
}

function metric(d,{bandwidth,delay,load=1,reliability=255}) {
  const [a,b,c,e,f]=weights(d);
  const inverse=Math.floor(10000000/bandwidth);
  return Math.round(256*(a*inverse+b*inverse/(256-load)+c*delay)*(f?f/(reliability+e||1):1));
}

function bestPaths(lab,d,ports) {
  const paths=new Map([[d.id,{device:d,bandwidth:Infinity,delay:0,distance:0}]]);
  const queue=[paths.get(d.id)];
  while(queue.length){
    const node=queue.shift();
    if(paths.get(node.device.id)!==node||node.device!==d&&node.device.eigrp.stub)continue;
    for(const {local,remote,device} of peers(lab,node.device,ports)){
      if(device===d||node.history?.includes(device.id))continue;
      const outgoing=node.device.ports[local.port];
      if(node.ingress===local.port&&outgoing.gre?.mode==='gre multipoint'&&outgoing.eigrpSplit?.[node.device.eigrp.asn]!==false)continue;
      const candidate={device,bandwidth:Math.min(node.bandwidth,local.bandwidth),
        delay:node.delay+local.delay,ingress:remote.port,port:node.port??local.port,next:node.next??remote.address,history:[...(node.history??[d.id]),device.id]};
      candidate.distance=metric(d,candidate);
      if((paths.get(device.id)?.distance??Infinity)<=candidate.distance)continue;
      paths.set(device.id,candidate);queue.push(candidate);
    }
  }
  return [...paths.values()].filter(path=>path.device!==d);
}

function advertised(lab,device,ports,underlay) {
  const cfg=device.eigrp;
  const native=cfg.stub?.includes('receive-only')||cfg.stub&&!cfg.stub.includes('connected')?[]:
    (ports.get(device.id)??[]).map(p=>({destination:networkAddress(p.address,p.prefix),prefix:p.prefix,delay:p.delay,bandwidth:p.bandwidth}));
  const external=Object.keys(cfg.redistribute).length?underlay(lab,device).flatMap(r=>{
    if(cfg.stub&&(r.protocol!=='static'||!cfg.stub.includes('static')))return [];
    const entry=own(cfg.redistribute,r.protocol);
    const seed=entry?.seed??cfg.defaultMetric;
    if(!entry||!seed||entry.process!==undefined&&entry.process!==r.process)return [];
    const policy=applyPolicy(device,entry.map,r);
    return policy?[{...policy,external:true,bandwidth:seed[0],delay:seed[1],reliability:seed[2],load:seed[3]}]:[];
  }):[];
  return [...native,...external];
}

export function eigrpRoutes(lab,d,underlay) {
  if(!d.eigrp?.asn||d.eigrp.shutdown)return [];
  const ports=new Map(lab.devices.filter(x=>x.eigrp).map(x=>[x.id,interfaces(lab,x)]));
  const result=new Map();
  for(const path of bestPaths(lab,d,ports)){
    const out=path.device.eigrp.filters?.out;
    const input=d.eigrp.filters?.in;
    for(const r of advertised(lab,path.device,ports,underlay)){
      if(out&&!prefixPermits(path.device,out,r)||input&&!prefixPermits(d,input,r))continue;
      const prefix=path.device.eigrp.autoSummary&&classful(r.destination)<r.prefix&&
        networkAddress(r.destination,classful(r.destination))!==networkAddress(path.next,classful(path.next))?classful(r.destination):r.prefix;
      const row={...r,prefix,destination:networkAddress(r.destination,prefix),port:path.port,next:path.next,distance:r.external?170:90,
        protocol:'eigrp',process:d.eigrp.asn,metric:metric(d,{...r,bandwidth:Math.min(r.bandwidth,path.bandwidth),delay:path.delay+r.delay})};
      const key=routeKey(row),previous=result.get(key);
      if(!previous||row.distance<previous.distance||row.distance===previous.distance&&row.metric<previous.metric)result.set(key,row);
    }
  }
  return [...result.values()];
}

export function eigrpShow(lab,d,args,underlay) {
  if(args[1]!=='ip'||args[2]!=='eigrp')return null;
  if(!d.eigrp?.asn||d.eigrp.shutdown)return reply('EIGRP is not running.');
  const ports=new Map(lab.devices.filter(x=>x.eigrp).map(x=>[x.id,interfaces(lab,x)]));
  const title='EIGRP IPv4 AS('+d.eigrp.asn+')';
  if(args[3]==='neighbors'){
    const neighbors=peers(lab,d,ports);
    return reply([title+' Neighbors',...neighbors.map(({device,local,remote})=>remote.address+'  '+local.port+'  '+device.name+
      (args[4]==='detail'?'  Hold '+(remote.hold??15)+'s'+(device.eigrp.stub?' · Stub':''):''))].join('\n'));
  }
  if(args[3]==='interfaces')return reply([title+' Interfaces',...ports.get(d.id).map(p=>p.port+'  '+p.address+
    (p.passive?'  Passive':'  Active')+(args[4]==='detail'?'  Hello '+(p.hello??5)+'s / hold '+(p.hold??15)+'s'+(p.auth?' · MD5':''):''))].join('\n'));
  const connected=(ports.get(d.id)??[]).map(p=>({destination:networkAddress(p.address,p.prefix),prefix:p.prefix,port:p.port,metric:metric(d,p)}));
  const rows=[...connected,...eigrpRoutes(lab,d,underlay)].filter(r=>!args[4]||args[4]==='all-links'||routeKey(r)===args[4]);
  return reply([title+' Topology',...rows.map(r=>'P '+routeKey(r)+', 1 successor, FD is '+r.metric+'\n  via '+(r.next??'Connected')+', '+r.port)].join('\n'));
}

export function eigrpRunning(d) {
  const lines=Object.entries(d.keyChains??{}).flatMap(([name,keys])=>['key chain '+name,...Object.entries(keys).flatMap(([id,key])=>[
    ' key '+id,...(key.value?['  key-string [configured]']:[]),...(key.algorithm?['  cryptographic-algorithm '+key.algorithm]:[])
  ])]);
  const e=d.eigrp;
  if(!e)return lines;
  const body=[
    ...(e.routerId?['eigrp router-id '+e.routerId]:[]),...(e.stub?['eigrp stub '+e.stub.join(' ')]:[]),
    ...(e.passiveDefault?['passive-interface default']:[]),
    ...Object.entries(e.passive).map(([port,on])=>(on?'':'no ')+'passive-interface '+port),
    ...e.networks.map(r=>'network '+r.address+' '+r.wildcard),
    ...Object.entries(e.redistribute).map(([name,row])=>'redistribute '+name+(row.process?' '+row.process:'')+(row.seed?' metric '+row.seed.join(' '):'')+(row.map?' route-map '+row.map:'')),
    ...Object.entries(e.filters??{}).map(([dir,name])=>'distribute-list prefix '+name+' '+dir)
  ];
  return [...lines,'router eigrp '+(e.name??e.asn),...(e.name&&e.asn?[' address-family ipv4 unicast autonomous-system '+e.asn]:[]),
    ...body.map(line=>(e.name?'  ':' ')+line)];
}
