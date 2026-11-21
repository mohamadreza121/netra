import { dotted, inSubnet, ipv4, mask, prefixLength } from './network.js';
import { invalid, reply, validIp, validName } from './ios.js';
import { aclPermits } from './acl.js';

const config = d => d.nat??={static:{},pools:{},rules:[],translations:[]};

export function natConfig(device, port, args) {
  const no=args[0]==='no', words=no?args.slice(1):args;
  if(words[0]!=='ip'||words[1]!=='nat')return null;
  if(port){
    if(no){if(device.ports[port].nat===words[2])delete device.ports[port].nat;}
    else device.ports[port].nat=words[2];
    return reply();
  }
  if(words[2]==='pool'){
    const [, , ,name,first,last,kind,length]=words;
    const prefix=kind==='netmask'?prefixLength(length):/^\d+$/.test(length??'')?Number(length):null;
    if(!validName(name)||['constructor','__proto__','prototype'].includes(name.toLowerCase()))return invalid('Enter a NAT pool name.');
    const nat=config(device);
    if(no){delete nat.pools[name];return reply();}
    if(!validIp(first)||!validIp(last)||ipv4(first)>ipv4(last)||prefix===null||prefix>32||!inSubnet(last,first,prefix))return invalid('Check the NAT pool range and mask.');
    nat.pools[name]={first,last,prefix};return reply();
  }
  if(words[4]==='static'){
    const [local,global]=words.slice(5);
    if(!validIp(local)||!validIp(global))return invalid('Use inside-local and inside-global IPv4 addresses.');
    const nat=config(device);
    if(no){if(nat.static[local]===global)delete nat.static[local];}
    else {
      if(Object.entries(nat.static).some(([key,value])=>value===global&&key!==local))return invalid('That global address is already mapped.');
      nat.static[local]=global;
    }
    return reply();
  }
  if(words[4]==='list'){
    const [access,kind,target,extra]=words.slice(5);
    const portName=/^gi(?:gabitethernet)?(0\/[0-3])$/i.exec(target??'');
    if(!validName(access)||!validName(target)&&!portName || kind==='interface'&&(!portName||!device.ports['Gi'+portName[1]]))return invalid('Choose a list and a valid NAT pool or outside interface.');
    const nat=config(device);
    const value=kind==='interface'?'Gi'+portName[1]:target;
    nat.rules=nat.rules.filter(rule=>!(rule.access===access&&rule.kind===kind&&rule.value===value));
    if(!no)nat.rules.push({access,kind,value,overload:extra==='overload'||kind==='interface'});
    return reply();
  }
  return invalid('Check the NAT arguments.');
}

export function natOut(device,source,destination,icmp) {
  const nat=device.nat;
  if(!nat) return source;
  if(nat.static[source]) return nat.static[source];
  const existing=nat.translations.find(t=>t.local===source&&t.remote===destination);
  if(existing) return existing.global;
  for(const rule of nat.rules) {
    if(!aclPermits(device,rule.access,source,destination,icmp,false))continue;
    const pool=Object.hasOwn(nat.pools,rule.value)&&nat.pools[rule.value];
    let global=rule.kind==='interface'?device.ports[rule.value]?.address:null;
    if(pool) {
      const used=new Set([...Object.values(nat.static),...nat.translations.map(t=>t.global)]);
      for(let i=ipv4(pool.first);i<=ipv4(pool.last);i++){
        const candidate=dotted(i);
        if(!used.has(candidate)){global=candidate;break;}
      }
      if(!global&&rule.overload)global=pool.first;
    }
    if(!global)continue;
    const row={local:source,global,remote:destination,id:(nat.translations.at(-1)?.id??0)+1};
    nat.translations=[...nat.translations.slice(-255),row];return global;
  }
  return source;
}

export function natIn(device,destination,source,originatingHost) {
  const nat=device.nat;
  if(!nat)return destination;
  const mapping=Object.entries(nat.static).find(([,global])=>global===destination)?.[0];
  const entry=nat.translations.find(t=>t.global===destination&&t.remote===source&&(!originatingHost||t.local===originatingHost));
  return mapping??entry?.local??destination;
}

export function natShow(device,statistics) {
  const nat=device.nat;
  const n=Object.keys(nat?.static??{}).length+(nat?.translations.length??0);
  if(statistics){
    const ports=kind=>Object.entries(device.ports).filter(([,p])=>p.nat===kind).map(([name])=>name).join(', ')||'none';
    return `Total active translations: ${n}\nInside interfaces: ${ports('inside')}\nOutside interfaces: ${ports('outside')}\nPools: ${Object.keys(nat?.pools??{}).join(', ')||'none'}`;
  }
  if(!n)return 'No NAT translations.';
  return ['Pro   Inside global          Inside local           Outside',
    ...Object.entries(nat.static).map(([local,global])=>'---   '+global.padEnd(23)+local),
    ...nat.translations.map(t=>`icmp  ${(t.global+':'+t.id).padEnd(23)}${t.local.padEnd(23)}${t.remote}`)].join('\n');
}

export function natRunning(device) {
  const nat=device.nat;
  return [
    ...Object.entries(nat?.static??{}).map(([local,global])=>'ip nat inside source static '+local+' '+global),
    ...Object.entries(nat?.pools??{}).map(([name,p])=>'ip nat pool '+name+' '+p.first+' '+p.last+' netmask '+dotted(mask(p.prefix))),
    ...(nat?.rules??[]).map(r=>'ip nat inside source list '+r.access+' '+r.kind+' '+r.value+(r.overload?' overload':''))
  ];
}
