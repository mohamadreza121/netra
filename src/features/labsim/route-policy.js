import { allowsTraffic } from './acl.js';
import { inSubnet, ipv4, networkAddress, prefixLength } from './network.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const prefixListVariants=sequence=>['permit','deny'].flatMap(action=>[
  'ip prefix-list <name>'+sequence+' '+action+' <network/length> [ge <min>] [le <max>]',
  'no ip prefix-list <name>'+sequence+' '+action+' <network/length> [ge <min>] [le <max>]'
]);
export const policyIOS={
  operational:['show ip prefix-list [<name>]','show route-map [<name>]','show ip policy'],
  global:[...prefixListVariants(''),...prefixListVariants(' seq <seq>'),'no ip prefix-list <name> [seq <seq>]',
    'route-map <name> permit [<seq>]','route-map <name> deny [<seq>]','no route-map <name>',
    'no route-map <name> permit <seq>','no route-map <name> deny <seq>'],
  interface:['ip policy route-map <name>','no ip policy route-map [<name>]'],
  routeMap:['match ip address <acls...>','no match ip address','match ip address prefix-list <names...>','no match ip address prefix-list','match tag <tag>','no match tag',
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

export function prefixPermits(device,name,route) {
  const rules=own(device.prefixLists,name);
  return rules?.find(r=>route.prefix>=r.min&&route.prefix<=r.max&&inSubnet(route.destination,r.destination,r.prefix))?.action==='permit';
}

export function applyPolicy(device,name,route) {
  if(!name)return route;
  const list=own(device.routeMaps,name);
  const entry=list?.find(row=>(!row.prefixLists?.length||row.prefixLists.some(key=>prefixPermits(device,key,route)))
    &&(row.matchTag===undefined||row.matchTag===route.tag)
    &&(!row.accessLists?.length||row.accessLists.some(name=>allowsTraffic(device,name,route.destination,route.destination,{protocol:'ip'},false))));
  if(!entry||entry.action!=='permit')return null;
  const {prepend,...attrs}=entry.set??{};
  return {...route,...attrs,...(prepend?{asPath:[...prepend,...(route.asPath??[])]}:{})};
}

function prefixLine(rule) {
  return 'seq '+rule.seq+' '+rule.action+' '+routeKey(rule)
    +(rule.ge!==undefined?' ge '+rule.ge:'')+(rule.le!==undefined?' le '+rule.le:'');
}

const attrs={'local-preference':'localPref',weight:'weight',metric:'metric',tag:'tag','as-path':'prepend',ip:'next'};
const setLine=(key,value)=>' set '+(key==='localPref'?'local-preference ':key==='next'?'ip next-hop ':key==='prepend'?'as-path prepend ':key+' ')+(Array.isArray(value)?value.join(' '):value);
const routeMapLines=(name,rows)=>rows.flatMap(row=>[
  'route-map '+name+' '+row.action+' '+row.seq,
  ...(row.accessLists?[' match ip address '+row.accessLists.join(' ')]:[]),
  ...(row.prefixLists?[' match ip address prefix-list '+row.prefixLists.join(' ')]:[]),
  ...(row.matchTag!==undefined?[' match tag '+row.matchTag]:[]),
  ...Object.entries(row.set??{}).map(([key,value])=>setLine(key,value))
]);

export function policyRunning(d) {
  return [
    ...Object.entries(d.prefixLists??{}).flatMap(([name,entries])=>entries.map(row=>'ip prefix-list '+name+' '+prefixLine(row))),
    ...Object.entries(d.routeMaps??{}).flatMap(([name,entries])=>routeMapLines(name,entries))
  ];
}

export function policyCLI(d,s,args,c) {
  if(c==='show ip policy')return reply(Object.entries(d.ports).filter(([,p])=>p.policy).map(([port,p])=>port+'  '+p.policy).join('\n')||'No interface policy maps.');
  if(c.startsWith('show ip prefix-list')){
    const name=args[3];
    return reply(Object.entries(d.prefixLists??{}).filter(([key])=>!name||key===name).flatMap(([key,rows])=>
      ['ip prefix-list '+key+': '+rows.length+' entries',...rows.map(r=>'   '+prefixLine(r))]).join('\n')||'No matching prefix lists.');
  }
  if(c.startsWith('show route-map')){
    return reply(Object.entries(d.routeMaps??{}).filter(([key])=>!args[2]||args[2]===key).flatMap(([key,rows])=>routeMapLines(key,rows)).join('\n')||'No matching route maps.');
  }
  const no=args[0]==='no';
  const w=no?args.slice(1):args;
  if(s.mode==='global'&&w[0]==='ip'&&w[1]==='prefix-list'){
    const [, , name,...rest]=w;
    if(!keyName(name))return invalid('Use a valid prefix-list name.');
    const list=d.prefixLists??={};
    const rules=own(list,name)??[];
    const seq=rest[0]==='seq'?rest.splice(0,2)[1]:undefined;
    if(seq!==undefined&&!integer(seq,1,4294967294))return invalid('Enter a valid prefix-list sequence.');
    if(no&&!rest.length){
      if(seq===undefined)delete list[name];
      else if(own(list,name))list[name]=rules.filter(r=>r.seq!==Number(seq));
      return reply();
    }
    const [action,raw]=rest;
    const route=parsePrefix(raw);
    const geAt=rest.indexOf('ge'), leAt=rest.indexOf('le');
    const ge=geAt<0?undefined:Number(rest[geAt+1]),le=leAt<0?undefined:Number(rest[leAt+1]);
    if(!route||geAt>=0&&!integer(rest[geAt+1],route.prefix,32)||leAt>=0&&!integer(rest[leAt+1],ge??route.prefix,32))return invalid('Enter a network prefix and a valid ge/le range.');
    const number=Number(seq??((rules.at(-1)?.seq??0)+5));
    const entry={...route,seq:number,action,ge,le,min:ge??route.prefix,max:le??(ge===undefined?route.prefix:32)};
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
      if(w[1]==='ip'){
        const prefix=w[3]==='prefix-list',key=prefix?'prefixLists':'accessLists';
        const names=w.slice(prefix?4:3);
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
      if(no){delete settings[key];return reply();}
      const value=w.at(-1);
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

export function policyNext(d,name,source,destination,packet,connected) {
  const rows=own(d.routeMaps,name);
  if(!rows)return null;
  const rule=rows.find(row=>!row.prefixLists&&row.matchTag===undefined&&(!row.accessLists?.length||row.accessLists.some(list=>
    allowsTraffic(d,list,source,destination,packet,false))));
  if(rule?.action!=='permit'||!rule.set?.next)return null;
  const port=connected.find(r=>inSubnet(rule.set.next,r.destination,r.prefix))?.port;
  return port?{port,next:rule.set.next}:null;
}
