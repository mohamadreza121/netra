import { matchesV6, networkV6, parsePrefixV6 } from './ipv6.js';
import { trackedUp } from './availability.js';
import { allowsTraffic } from './acl.js';
import { inSubnet, ipv4, networkAddress, prefixLength } from './network.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const prefixListVariants=(sequence,family='ip')=>['permit','deny'].flatMap(action=>[
  family+' prefix-list <name>'+sequence+' '+action+' <network/length> [ge <min>] [le <max>]',
  'no '+family+' prefix-list <name>'+sequence+' '+action+' <network/length> [ge <min>] [le <max>]'
]);
export const policyIOS={
  operational:['show ip prefix-list [<name>]','show route-map [<name>]','show ip policy','show ipv6 prefix-list [<name>]','show ip as-path-access-list [<name>]','show ip community-list [<name>]' ],
  global:[...prefixListVariants(''),...prefixListVariants(' seq <seq>'),'no ip prefix-list <name> [seq <seq>]',...prefixListVariants('','ipv6'),...prefixListVariants(' seq <seq>','ipv6'),'no ipv6 prefix-list <name> [seq <seq>]',
    ...['permit','deny'].flatMap(action=>['ip as-path access-list <id> '+action+' <expression...>',
      'ip community-list standard <name> '+action+' <community...>','ip community-list expanded <name> '+action+' <expression...>']),
    'no ip as-path access-list <id>','no ip community-list standard <name>','no ip community-list expanded <name>',
    'ip local policy route-map <name>','no ip local policy route-map [<name>]',
    'route-map <name> permit [<seq>]','route-map <name> deny [<seq>]','no route-map <name>',
    'no route-map <name> permit <seq>','no route-map <name> deny <seq>'],
  interface:['ip policy route-map <name>','no ip policy route-map [<name>]'],
  routeMap:['match ip address <acls...>','no match ip address','match ip address prefix-list <names...>','no match ip address prefix-list','match tag <tag>','no match tag','match ipv6 address prefix-list <names...>','no match ipv6 address prefix-list',
    'match as-path <names...>','no match as-path','match community <names...>','no match community',
    'set community <communities...>','no set community','set metric-type type-1','set metric-type type-2','no set metric-type',
    'set ip next-hop verify-availability <address> <sequence> track <id>','no set ip next-hop verify-availability <address> <sequence> track <id>',
    'set local-preference <value>','no set local-preference','set weight <value>','no set weight','set metric <value>','no set metric',
    'set tag <value>','no set tag','set as-path prepend <asns...>','no set as-path prepend','set ip next-hop <address>','no set ip next-hop']
};

export const routeKey=route=>route.destination+'/'+route.prefix;
const matches=(a,b)=>a.action===b.action&&a.destination===b.destination&&a.prefix===b.prefix&&a.min===b.min&&a.max===b.max;
const parsePrefix=value=>{
  const [address,length,extra]=value?.split('/')??[];
  const prefix=prefixLength(length);
  return ipv4(address)!==null&&integer(length,0,32)&&!extra&&networkAddress(address,prefix)===address?{destination:address,prefix}:null;
};

export function routingExpression(text) {
  if(!/^[0-9:_ ^$.*+\[\]-]{1,80}$/.test(text)||(text.match(/[.*+_]/g)??[]).length>6||
    !/^(?:[0-9:_ ^$-]|\.\*|\[[0-9-]+\]\+?)+$/.test(text))return null;
  try{return new RegExp(text.replaceAll('_','(?:^| |$)'));}catch{return null;}
}

const wellKnown=new Set(['internet','local-as','no-export','no-advertise']);
function validCommunity(word) {
  const [asn,value]=word.split(':');
  return wellKnown.has(word)||integer(asn,0,65535)&&integer(value,0,65535)&&word.split(':').length===2;
}
function listPermits(rows,value) {
  return rows?.find(row=>routingExpression(row.expression)?.test(value))?.action==='permit';
}
export const pathPermits=(d,name,path)=>listPermits(own(d.asPathLists,name),path.join(' '));
function communityPermits(d,name,communities) {
  const rows=own(d.communityLists,name);
  return rows?.find(row=>row.kind==='standard'?row.communities.every(key=>communities.includes(key)):
    routingExpression(row.expression)?.test(communities.join(' ')))?.action==='permit';
}

export function prefixPermits(device,name,route) {
  const isV6=route.destination.includes(':');
  const rules=own(isV6?device.prefixLists6:device.prefixLists,name);
  return rules?.find(r=>route.prefix>=r.min&&route.prefix<=r.max&&
    (isV6?matchesV6:inSubnet)(route.destination,r.destination,r.prefix))?.action==='permit';
}

export function applyPolicy(device,name,route) {
  if(!name)return route;
  const list=own(device.routeMaps,name);
  const v6=route.destination.includes(':');
  const entry=list?.find(row=>(!row.prefixLists?.length||!v6&&row.prefixLists.some(key=>prefixPermits(device,key,route)))
    &&(!row.prefixLists6?.length||v6&&row.prefixLists6.some(key=>prefixPermits(device,key,route)))
    &&(row.matchTag===undefined||row.matchTag===route.tag)
    &&(!row.asPaths?.length||row.asPaths.some(key=>pathPermits(device,key,route.asPath??[])))
    &&(!row.communityLists?.length||row.communityLists.some(key=>communityPermits(device,key,route.communities??[])))
    &&(!row.accessLists?.length||row.accessLists.some(name=>allowsTraffic(device,name,route.destination,route.destination,{protocol:'ip'},false))));
  if(!entry||entry.action!=='permit')return null;
  const {prepend,community,tracked,...attrs}=entry.set??{};
  return {...route,...attrs,...(prepend?{asPath:[...prepend,...(route.asPath??[])]}:{}),
    ...(community?{communities:community.clear?[]:[...new Set([...(community.additive?route.communities??[]:[]),...community.values])]}:{})};
}

function prefixLine(rule) {
  return 'seq '+rule.seq+' '+rule.action+' '+routeKey(rule)
    +(rule.ge!==undefined?' ge '+rule.ge:'')+(rule.le!==undefined?' le '+rule.le:'');
}

const attrs={'local-preference':'localPref',weight:'weight',metric:'metric',tag:'tag','as-path':'prepend',ip:'next','metric-type':'metricType',community:'community'};
function setLines(key,value) {
  if(key==='tracked')return value.map(r=>' set ip next-hop verify-availability '+r.address+' '+r.sequence+' track '+r.track);
  if(key==='community')return [' set community '+(value.clear?'none':value.values.join(' ')+(value.additive?' additive':''))];
  if(key==='metricType')return [' set metric-type type-'+value];
  return [' set '+(key==='localPref'?'local-preference ':key==='next'?'ip next-hop ':key==='prepend'?'as-path prepend ':key+' ')+(Array.isArray(value)?value.join(' '):value)];
}
const routeMapLines=(name,rows)=>rows.flatMap(row=>[
  'route-map '+name+' '+row.action+' '+row.seq,
  ...(row.accessLists?[' match ip address '+row.accessLists.join(' ')]:[]),
  ...(row.prefixLists?[' match ip address prefix-list '+row.prefixLists.join(' ')]:[]),
  ...(row.prefixLists6?[' match ipv6 address prefix-list '+row.prefixLists6.join(' ')]:[]),
  ...(row.asPaths?[' match as-path '+row.asPaths.join(' ')]:[]),
  ...(row.communityLists?[' match community '+row.communityLists.join(' ')]:[]),
  ...(row.matchTag!==undefined?[' match tag '+row.matchTag]:[]),
  ...Object.entries(row.set??{}).flatMap(([key,value])=>setLines(key,value))
]);

export function policyRunning(d) {
  return [
    ...Object.entries(d.prefixLists??{}).flatMap(([name,entries])=>entries.map(row=>'ip prefix-list '+name+' '+prefixLine(row))),
    ...Object.entries(d.prefixLists6??{}).flatMap(([name,entries])=>entries.map(row=>'ipv6 prefix-list '+name+' '+prefixLine(row))),
    ...Object.entries(d.asPathLists??{}).flatMap(([name,entries])=>entries.map(row=>'ip as-path access-list '+name+' '+row.action+' '+row.expression)),
    ...Object.entries(d.communityLists??{}).flatMap(([name,entries])=>entries.map(row=>'ip community-list '+row.kind+' '+name+' '+row.action+' '+(row.expression??row.communities.join(' ')))),
    ...(d.localPolicy?['ip local policy route-map '+d.localPolicy]:[]),
    ...Object.entries(d.routeMaps??{}).flatMap(([name,entries])=>routeMapLines(name,entries))
  ];
}

export function policyCLI(d,s,args,c) {
  if(c==='show ip policy')return reply([...(d.localPolicy?['Local  '+d.localPolicy]:[]),...Object.entries(d.ports).filter(([,p])=>p.policy).map(([port,p])=>port+'  '+p.policy)].join('\n')||'No interface policy maps.');
  if(/^show (?:ip|ipv6) prefix-list/.test(c)){
    const name=args[3];
    return reply(Object.entries(args[1]==='ipv6'?d.prefixLists6??{}:d.prefixLists??{}).filter(([key])=>!name||key===name).flatMap(([key,rows])=>
      [args[1]+' prefix-list '+key+': '+rows.length+' entries',...rows.map(r=>'   '+prefixLine(r))]).join('\n')||'No matching prefix lists.');
  }
  if(c.startsWith('show ip as-path-access-list')||c.startsWith('show ip community-list')){
    const lists=args[2]==='community-list'?d.communityLists:d.asPathLists;
    return reply(Object.entries(lists??{}).filter(([name])=>!args[3]||name===args[3]).flatMap(([name,entries])=>
      entries.map(row=>name+' '+row.action+' '+(row.expression??row.communities.join(' ')))).join('\n')||'No matching route filters.');
  }
  if(c.startsWith('show route-map')){
    return reply(Object.entries(d.routeMaps??{}).filter(([key])=>!args[2]||args[2]===key).flatMap(([key,rows])=>routeMapLines(key,rows)).join('\n')||'No matching route maps.');
  }
  const no=args[0]==='no';
  const w=no?args.slice(1):args;
  if(s.mode==='global'&&w[0]==='ip'&&w[1]==='local'&&w[2]==='policy'){
    if(no)delete d.localPolicy;
    else if(own(d.routeMaps,w[4]))d.localPolicy=w[4];
    else return invalid('Create the named policy route map first.');
    return reply();
  }
  if(s.mode==='global'&&w[0]==='ip'&&['as-path','community-list'].includes(w[1])){
    const isPath=w[1]==='as-path';
    const list=isPath?(d.asPathLists??={}):(d.communityLists??={});
    const [, , kind,name,action,...values]=w;
    if(!keyName(name))return invalid('Use a valid route filter name.');
    if(no){delete list[name];return reply();}
    const expression=values.join(' ');
    const conventional=kind==='standard';
    if(conventional?!values.every(validCommunity):!routingExpression(expression))return invalid('Use a valid community or bounded AS-path expression.');
    const entry={kind,action,...(conventional?{communities:values}:{expression})};
    list[name]=[...(own(list,name)??[]).filter(row=>JSON.stringify(row)!==JSON.stringify(entry)),entry];
    return reply();
  }
  if(s.mode==='global'&&['ip','ipv6'].includes(w[0])&&w[1]==='prefix-list'){
    const [, , name,...rest]=w;
    if(!keyName(name))return invalid('Use a valid prefix-list name.');
    const v6=w[0]==='ipv6';
    const list=v6?(d.prefixLists6??={}):(d.prefixLists??={});
    const rules=own(list,name)??[];
    const seq=rest[0]==='seq'?rest.splice(0,2)[1]:undefined;
    if(seq!==undefined&&!integer(seq,1,4294967294))return invalid('Enter a valid prefix-list sequence.');
    if(no&&!rest.length){
      if(seq===undefined)delete list[name];
      else if(own(list,name))list[name]=rules.filter(r=>r.seq!==Number(seq));
      return reply();
    }
    const [action,raw]=rest;
    const net=v6?parsePrefixV6(raw):null;
    const route=v6?(net&&networkV6(net.address,net.prefix)===net.address?{destination:net.address,prefix:net.prefix}:null):parsePrefix(raw);
    const max=v6?128:32;
    const geAt=rest.indexOf('ge'), leAt=rest.indexOf('le');
    const ge=geAt<0?undefined:Number(rest[geAt+1]),le=leAt<0?undefined:Number(rest[leAt+1]);
    if(!route||geAt>=0&&!integer(rest[geAt+1],route.prefix,max)||leAt>=0&&!integer(rest[leAt+1],ge??route.prefix,max))return invalid('Enter a network prefix and a valid ge/le range.');
    const number=Number(seq??((rules.at(-1)?.seq??0)+5));
    const entry={...route,seq:number,action,ge,le,min:ge??route.prefix,max:le??(ge===undefined?route.prefix:max)};
    list[name]=(no?rules.filter(r=>seq===undefined?!matches(r,entry):r.seq!==number):[...rules.filter(r=>r.seq!==number),entry]).sort((a,b)=>a.seq-b.seq);
    return reply();
  }
  if(s.mode==='global'&&w[0]==='route-map'){
    const [,name,action,raw]=w;
    const seq=Number(raw??10);
    if(!keyName(name)||!integer(String(seq),0,65535))return invalid('Enter a valid map name and sequence.');
    const maps=d.routeMaps??={};
    const rows=own(maps,name)??[];
    if(no){
      if(action)maps[name]=rows.filter(row=>row.seq!==seq||row.action!==action);
      else delete maps[name];
      return reply();
    }
    const previous=rows.find(r=>r.seq===seq);
    maps[name]=[...rows.filter(r=>r.seq!==seq),{...previous,action,seq}].sort((a,b)=>a.seq-b.seq);
    return enter(s,'routeMap',{name,seq});
  }
  if(s.mode==='routeMap'){
    const row=own(d.routeMaps,s.current.name)?.find(r=>r.seq===s.current.seq);
    if(!row)return invalid('This route map no longer exists.');
    if(w[0]==='match'){
      if(['ip','ipv6','as-path','community'].includes(w[1])){
        const prefix=w[3]==='prefix-list';
        const key={ipv6:'prefixLists6',ip:prefix?'prefixLists':'accessLists','as-path':'asPaths',community:'communityLists'}[w[1]];
        const names=w.slice(['as-path','community'].includes(w[1])?2:prefix?4:3);
        if(no)delete row[key];
        else if(names.every(keyName))row[key]=names;
        else return invalid('Enter valid access-list or prefix-list names.');
      }else if(no)delete row.matchTag;
      else if(integer(w[2],0,4294967295))row.matchTag=Number(w[2]);
      else return invalid('Enter a 32-bit unsigned tag.');
      return reply();
    }
    if(w[0]==='set'){
      const key=attrs[w[1]];
      const settings=row.set??={};
      if(w[3]==='verify-availability'){
        const address=w[4],sequence=w[5],track=w[7];
        if(ipv4(address)===null||!integer(sequence,1,65535)||!integer(track,1,1000))return invalid('Check the next hop, order and tracking ID.');
        settings.tracked=(settings.tracked??[]).filter(r=>r.sequence!==Number(sequence));
        if(!no)settings.tracked.push({address,sequence:Number(sequence),track:Number(track)});
        return reply();
      }
      if(no){delete settings[key];return reply();}
      const value=w.at(-1);
      if(key==='community'){
        const additive=value==='additive',values=w.slice(2,additive?-1:undefined);
        if(values.length===1&&values[0]==='none'){settings.community={clear:true,values:[]};return reply();}
        if(!values.length||!values.every(validCommunity))return invalid('Use a valid community such as 65030:70 or no-export.');
        settings.community={values,additive};return reply();
      }
      if(key==='metricType'){settings.metricType=value==='type-1'?1:2;return reply();}
      if(key==='next'&&ipv4(value)!==null)settings[key]=value;
      else if(key==='prepend'&&w.length<=13&&w.slice(3).every(as=>integer(as,1,4294967295)))settings[key]=w.slice(3).map(Number);
      else if(!['next','prepend'].includes(key)&&integer(value,0,key==='weight'?65535:4294967295))settings[key]=Number(value);
      else return invalid('Check the route-map attribute value.');
      return reply();
    }
  }
  return null;
}

export function policyPort(d,p,args,c) {
  if(!c.includes('ip policy route-map'))return null;
  if(args[0]==='no'){delete p.policy;return reply();}
  if(!own(d.routeMaps,args[3]))return invalid('Create the policy route map first.');
  p.policy=args[3];return reply();
}

export function policyNext(lab,d,name,source,destination,packet,connected) {
  const rows=own(d.routeMaps,name);
  if(!rows)return null;
  const rule=rows.find(row=>!row.prefixLists&&!row.prefixLists6&&!row.asPaths&&!row.communityLists&&row.matchTag===undefined&&(!row.accessLists?.length||row.accessLists.some(list=>
    allowsTraffic(d,list,source,destination,packet,false))));
  if(rule?.action!=='permit')return null;
  const setting=rule.set;
  const candidates=(setting?.tracked??[]).toSorted((a,b)=>a.sequence-b.sequence).filter(row=>trackedUp(lab,d,row.track)).map(row=>row.address);
  if(setting?.next)candidates.push(setting.next);
  for(const next of candidates){
    const port=connected.find(r=>inSubnet(next,r.destination,r.prefix))?.port;
    if(port)return {port,next};
  }
  return null;
}
