import { forwardsIpv4, ipv4, linkUp, networkAddress, segment } from './network.js';
import { areaId, areaPaths, areasAt, routerId, throughArea } from './ospf.js';
import { interfaceName } from './ios.js';
import { interfacesV6, matchesV6, networkV6, parsePrefixV6 } from './ipv6.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const processes=['router-id <address>','passive-interface <interface...>','no passive-interface <interface...>',
  'area <area> range <prefix> [not-advertise]','no area <area> range <prefix>',
  'area <area> stub [no-summary]','no area <area> stub','default-information originate [always]','no default-information originate'];
const attach=['ospfv3 <id> ipv4 area <area>','ospfv3 <id> ipv6 area <area>','ipv6 ospf <id> area <area>'];
export const ospfv3IOS={
  operational:['show ospfv3 [neighbor]','show ospfv3 neighbor detail','show ospfv3 interface [<interface...>]',
    'show ospfv3 database','show ipv6 ospf [neighbor]','show ipv6 ospf interface [<interface...>]',
    'show ipv6 ospf interface brief','show ipv6 route ospf'],
  global:['router ospfv3 <id>','no router ospfv3 <id>','ipv6 router ospf <id>','no ipv6 router ospf <id>'],
  interface:[...attach,...attach.map(line=>'no '+line),'ospfv3 network point-to-point','ospfv3 network broadcast',
    'ospfv3 authentication key-chain <name>','ospfv3 authentication null','no ospfv3 authentication',
    'ospfv3 <id> ipv6 authentication key-chain <name>','ospfv3 <id> ipv4 authentication key-chain <name>',
    'ospfv3 cost <cost>','ospfv3 hello-interval <seconds>','ospfv3 dead-interval <seconds>'],
  ospfv3:['address-family ipv4 [unicast]','address-family ipv6 [unicast]',...processes],
  ospfv3Af:['exit-address-family',...processes]
};

const context=(d,id,family)=>{
  const table=d.ospfv3??={};
  const cfg=table[id]??={families:{}};
  return [cfg,family?(cfg.families[family]??={areas:{},passive:{}}):null];
};
const strip=words=>words[0]==='no'?words.slice(1):words;

export function ospfv3Port(d,name,args) {
  const words=strip(args);
  if(words[0]!=='ospfv3'&&(words[0]!=='ipv6'||words[1]!=='ospf'))return null;
  const port=d.ports[name],no=args[0]==='no';
  if(d.type==='switch'&&!name.startsWith('Vlan')&&!name.startsWith('Lo')&&port.mode!=='routed')return invalid('Use an OSPFv3 routed interface.');
  const settings=port.ospfv3??={families:{}};
  const legacy=words[0]==='ipv6';
  const family=legacy?'ipv6':words[2]==='ipv4'||words[2]==='ipv6'?words[2]:null;
  const id=legacy?words[2]:words[1];
  if(words[3]==='area'){
    const area=areaId(words[4]);
    if(!family||!integer(id,1,65535)||area===null)return invalid('Check the OSPFv3 process ID and area.');
    if(no){delete settings.families[family];return reply();}
    if(port.vrf)return invalid('Use a global routed interface for this OSPFv3 process.');
    context(d,id,family);
    settings.families[family]={...settings.families[family],id,area};
    port.ipv6Enabled=true;
    return reply();
  }
  if(words.includes('authentication')){
    const index=words.indexOf('authentication');
    const target=family?settings.families[family]:settings;
    if(family&&(!target||target.id!==id))return invalid('Enable the selected address family on this interface first.');
    if(no||words[index+1]==='null'){target.keychain=undefined;target.noAuth=!no;return reply();}
    if(!keyName(words[index+2]))return invalid('Specify a key chain name.');
    target.keychain=words[index+2];delete target.noAuth;return reply();
  }
  if(words[1]==='network'){settings.network=words[2];return reply();}
  if(['cost','hello-interval','dead-interval'].includes(words[1])&&integer(words[2],1,65535)){
    settings[words[1]]=Number(words[2]);return reply();
  }
  return invalid('Check the interface OSPFv3 arguments.');
}

export function ospfv3CLI(lab,d,s,args,c) {
  if(s.mode==='global'&&/^(?:no )?(?:router ospfv3|ipv6 router ospf) /.test(c)){
    const id=args.at(-1),legacy=args.includes('ospf');
    if(!integer(id,1,65535))return invalid('Use an OSPFv3 process ID 1–65535.');
    if(args[0]==='no'){
      if(d.ospfv3)delete d.ospfv3[id];
      return reply();
    }
    const [cfg]=context(d,id,legacy?'ipv6':null);
    if(legacy)cfg.legacy=true;
    return enter(s,'ospfv3',{id,family:legacy?'ipv6':null});
  }
  if(args[0]==='show'&&(args[1]==='ospfv3'||args[1]==='ipv6'&&args[2]==='ospf'))return ospfv3Show(lab,d,args);
  if(!['ospfv3','ospfv3Af'].includes(s.mode))return null;
  const {id,family}=s.current, [cfg,af]=context(d,id,family);
  const [verb,arg,...rest]=strip(args);
  const remove=args[0]==='no';
  if(verb==='address-family'){context(d,id,arg);return enter(s,'ospfv3Af',{id,family:arg},true);}
  if(verb==='exit-address-family'){s.parents?.pop();return enter(s,'ospfv3',{id,family:null});}
  if(verb==='router-id'){
    if(ipv4(arg)===null||arg==='0.0.0.0')return invalid('Use a nonzero IPv4-format router ID.');
    cfg.routerId=arg;return reply();
  }
  const data=af??context(d,id,'ipv6')[1];
  if(verb==='passive-interface'){
    if(arg==='default'){data.passiveDefault=!remove;return reply();}
    const port=interfaceName([arg,...rest]);
    if(!d.ports[port])return invalid('Select an existing interface.');
    data.passive[port]=!remove;return reply();
  }
  if(verb==='default-information'){data.defaultRoute=remove?undefined:rest.includes('always')?'always':true;return reply();}
  if(verb==='area'){
    const area=areaId(arg);
    if(area===null)return invalid('Use a valid area ID.');
    const row=data.areas[area]??={};
    if(rest[0]==='stub'){
      if(!area)return invalid('Area 0 cannot be a stub.');
      row.stub=!remove;row.noSummary=!remove&&rest[1]==='no-summary';return reply();
    }
    if(rest[0]==='range'&&family!=='ipv4'){
      const prefix=parsePrefixV6(rest[1]);
      if(!prefix||networkV6(prefix.address,prefix.prefix)!==prefix.address)return invalid('Use an IPv6 network prefix.');
      row.ranges=(row.ranges??[]).filter(p=>p.address!==prefix.address||p.prefix!==prefix.prefix);
      if(!remove)row.ranges.push({...prefix,hidden:rest[2]==='not-advertise'});return reply();
    }
  }
  return invalid('Check the OSPFv3 process arguments.');
}

function ospfv3Interfaces(lab,d,family) {
  if(!d.ospfv3||!d.ipv6Routing||family==='ipv4'&&!forwardsIpv4(d))return [];
  return Object.entries(d.ports).flatMap(([port,p])=>{
    const setting=p.ospfv3?.families[family], cfg=own(d.ospfv3,setting?.id);
    if(!cfg||p.vrf||!linkUp(lab,d,port))return [];
    const ipv6=interfacesV6(d,port);
    const addresses=family==='ipv4'?(p.address?[{address:p.address,prefix:p.prefix}]:[]):ipv6.filter(a=>!a.linkLocal);
    const control=ipv6.find(a=>a.linkLocal)?.address;
    const next=family==='ipv4'?p.address:control;
    const id=cfg.routerId??routerId(d),af=cfg.families[family];
    if(!next||!control||!id||!af)return [];
    const area=setting.area,key=setting.noAuth?undefined:setting.keychain??p.ospfv3.keychain;
    return [{port,id:setting.id,router:id,area,address:next,addresses,auth:key,
      network:p.ospfv3.network??'broadcast',hello:p.ospfv3['hello-interval']??10,dead:p.ospfv3['dead-interval']??40,cost:p.ospfv3.cost??1,
      passive:af.passive[port]??af.passiveDefault??false,stub:af.areas[area]?.stub??false}];
  });
}

function ospfv3Neighbors(lab,d,snapshot) {
  return (snapshot.get(d.id)??[]).flatMap(local=>{
    if(local.passive||local.port.startsWith('Lo'))return [];
    return segment(lab,d,local.port,false,'control').flatMap(({device,port})=>{
      const remote=snapshot.get(device.id)?.find(row=>row.port===port&&row.area===local.area);
      if(!remote||remote.passive||remote.router===local.router||remote.stub!==local.stub||
        remote.network!==local.network||remote.hello!==local.hello||remote.dead!==local.dead||Boolean(remote.auth)!==Boolean(local.auth))return [];
      const matching=!local.auth||Object.entries(own(d.keyChains,local.auth)??{}).some(([id,key])=>{
        const other=own(device.keyChains,remote.auth)?.[id];
        return key.value&&other?.value===key.value&&(other.algorithm??'hmac-sha-256')===(key.algorithm??'hmac-sha-256');
      });
      return matching?[{device,local,remote}]:[];
    });
  });
}

const snapshot=(lab,family)=>new Map(lab.devices.filter(d=>d.ospfv3).map(d=>[d.id,ospfv3Interfaces(lab,d,family)]));
const configuration=(d,id,family)=>d.ospfv3?.[id]?.families[family];

export function ospfv3Routes(lab,d,family,staticRoutes) {
  if(!d.ospfv3||!d.ipv6Routing)return [];
  const ports=snapshot(lab,family),rows=[];
  for(const path of areaPaths(lab,d,ports,ospfv3Neighbors)){
    const device=path.device,areaSet=areasAt(ports,device);
    const rootArea=path.areas[0],root=(ports.get(d.id)??[]).find(i=>i.area===rootArea);
    const stub=root?.stub??false;
    const ipv6=family==='ipv6';
    const append=(destination,prefix,metric,type,process)=>rows.push({destination,prefix,metric,
      distance:110,next:path.next,port:path.port,protocol:'ospf',ospfType:type,process});
    if(stub&&areaSet.has(0)&&areaSet.has(rootArea))append(ipv6?'::':'0.0.0.0',0,path.metric+1,'IA',root.id);
    for(const local of ports.get(device.id)){
      const pathAreas=throughArea(path.areas,local.area,areaSet),af=configuration(device,local.id,family);
      if(!pathAreas)continue;
      const inter=pathAreas.length>1;
      if(inter&&stub&&path.history.some(node=>(ports.get(node.id)??[]).some(port=>configuration(node,port.id,family)?.areas[rootArea]?.noSummary)))continue;
      for(const address of local.addresses){
        const network=ipv6?networkV6(address.address,address.prefix):networkAddress(address.address,address.prefix);
        const range=ipv6&&inter?path.history.toReversed().flatMap(node=>(ports.get(node.id)??[]).filter(port=>port.area===local.area&&areasAt(ports,node).has(0)).
          flatMap(port=>configuration(node,port.id,family)?.areas[port.area]?.ranges??[])).sort((a,b)=>b.prefix-a.prefix)
          .find(row=>address.prefix>=row.prefix&&matchesV6(network,row.address,row.prefix)):undefined;
        if(!range?.hidden)append(range?.address??network,range?.prefix??address.prefix,path.metric+local.cost,inter?'IA':undefined,root?.id);
      }
      if(!stub&&af?.defaultRoute&&(af.defaultRoute==='always'||staticRoutes(lab,device).some(r=>r.prefix===0))){
        append(ipv6?'::':'0.0.0.0',0,1,'E2',root?.id);
      }
    }
  }
  return rows;
}

function ospfv3Show(lab,d,args) {
  const mode=args[1]==='ipv6'?3:2,argsTail=args.slice(mode);
  const families=mode===3?['ipv6']:['ipv4','ipv6'];
  const rows=families.flatMap(family=>{
    const ports=snapshot(lab,family);
    if(argsTail[0]==='neighbor')return ospfv3Neighbors(lab,d,ports).map(({local,remote})=>
      'OSPFv3 '+local.id+' '+family+'  '+remote.router+'  FULL  '+local.port+'  Area '+local.area+'  '+remote.address);
    const selected=argsTail[0]==='interface'&&argsTail[1]!=='brief'&&argsTail[1]?interfaceName(argsTail.slice(1)):null;
    return (ports.get(d.id)??[]).filter(p=>!selected||p.port===selected).map(p=>
      'OSPFv3 '+p.id+' '+family+'  '+p.port+'  Area '+p.area+'  Cost '+p.cost+'  '+p.network+(p.auth?'  Authentication key-chain '+p.auth:'')+
      (argsTail[0]==='database'?'  '+p.addresses.map(a=>a.address+'/'+a.prefix).join(', '):''));
  });
  return reply(rows.join('\n')||(argsTail[0]==='neighbor'?'No FULL OSPFv3 adjacencies.':'No OSPFv3 interfaces.'));
}

export function ospfv3Running(d) {
  return Object.entries(d.ospfv3??{}).flatMap(([id,cfg])=>[(cfg.legacy?'ipv6 router ospf ':'router ospfv3 ')+id,
    ...(cfg.routerId?[' router-id '+cfg.routerId]:[]),
    ...Object.entries(cfg.families).flatMap(([family,af])=>[
      ...(cfg.legacy?[]:[' address-family '+family+' unicast']),
      ...Object.entries(af.passive).map(([port,on])=>'  '+(on?'':'no ')+'passive-interface '+port),
      ...Object.entries(af.areas).flatMap(([id,area])=>[
        ...(area.stub?['  area '+id+' stub'+(area.noSummary?' no-summary':'')]:[]),
        ...(area.ranges??[]).map(row=>'  area '+id+' range '+row.address+'/'+row.prefix+(row.hidden?' not-advertise':''))
      ])
    ])
  ]);
}

export function ospfv3PortLines(p) {
  return Object.entries(p.ospfv3?.families??{}).flatMap(([family,context])=>[
    ' ospfv3 '+context.id+' '+family+' area '+context.area,
    ...(context.keychain?[' ospfv3 '+context.id+' '+family+' authentication key-chain '+context.keychain]:[])
  ]).concat(p.ospfv3?.network?[' ospfv3 network '+p.ospfv3.network]:[],
    p.ospfv3?.keychain?[' ospfv3 authentication key-chain '+p.ospfv3.keychain]:[],
    ['cost','hello-interval','dead-interval'].filter(key=>p.ospfv3?.[key]).map(key=>' ospfv3 '+key+' '+p.ospfv3[key]));
}
