import { inSubnet, ipv4, prefixLength } from './network.js';
import { tunnelPeers } from './gre.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

export const ipsecIOS={
  operational:['show crypto ikev2 sa [detail]','show crypto ipsec sa [detail]','show crypto session [detail]'],
  global:['crypto ikev2 proposal <name>','crypto ikev2 policy <name>','crypto ikev2 keyring <name>','crypto ikev2 profile <name>',
    'no crypto ikev2 proposal <name>','no crypto ikev2 policy <name>','no crypto ikev2 keyring <name>','no crypto ikev2 profile <name>',
    'crypto ipsec transform-set <name> <transforms...>','no crypto ipsec transform-set <name>',
    'crypto ipsec profile <name>','no crypto ipsec profile <name>'],
  ikeProposal:['encryption <algorithms...>','integrity <algorithms...>','prf <algorithms...>','group <numbers...>'],
  ikePolicy:['proposal <name>','no proposal <name>','match fvrf any'],
  ikeKeyring:['peer <name>','no peer <name>'],
  ikePeer:['address <address> [<mask>]','pre-shared-key <key>','pre-shared-key local <key>','pre-shared-key remote <key>'],
  ikeProfile:['match identity remote address <address> [<mask>]','authentication remote pre-share','authentication local pre-share','keyring local <name>'],
  ipsecTransform:['mode transport','mode tunnel'],
  ipsecProfile:['set transform-set <names...>','set ikev2-profile <name>','set pfs <group>']
};
const ikeModes={proposal:'ikeProposal',policy:'ikePolicy',keyring:'ikeKeyring',profile:'ikeProfile'};
const keys=['proposals','policies','keyrings','profiles','transforms','protections'];
const ipsec=d=>d.ipsec??=Object.fromEntries(keys.map(k=>[k,{}]));

const proposals=(d,profile)=>Object.values(d.ipsec.policies).flatMap(policy=>policy.proposals??[])
  .map(name=>own(d.ipsec.proposals,name)).filter(p=>p?.encryption?.length&&(p.integrity?.length||p.encryption.every(a=>a.includes('gcm')))&&p.group?.length)
  .filter(p=>profile?.match!==false);

const intersection=(a,b)=>a?.find(x=>b?.includes(x));
const matchPeer=(profile,key,remote)=>profile.remote&&inSubnet(remote,profile.remote.address,profile.remote.prefix)&&key.address&&inSubnet(remote,key.address,key.prefix);

function localPeer(d,port,remote) {
  const data=d.ipsec,protect=own(data?.protections,port.gre?.protection);
  const profile=own(data?.profiles,protect?.ikev2);
  if(!profile?.local||!profile?.remoteAuth)return null;
  const ring=own(data.keyrings,profile.keyring);
  const peer=Object.values(ring??{}).find(row=>matchPeer(profile,row,remote));
  if(!peer?.local||!peer.remote)return null;
  return {peer,protect,proposals:proposals(d,profile),sets:(protect.transforms??[]).map(name=>own(data.transforms,name)).filter(Boolean)};
}

export function negotiateIpsec(d,p,source,remote,q,destination) {
  const first=localPeer(d,p,destination),second=localPeer(remote,q,source);
  if(!first||!second||first.peer.local!==second.peer.remote||first.peer.remote!==second.peer.local||
    (first.protect.pfs??null)!==(second.protect.pfs??null))return null;
  let agreed;
  for(const a of first.proposals)for(const b of second.proposals){
    const encryption=intersection(a.encryption,b.encryption),integrity=intersection(a.integrity,b.integrity),group=intersection(a.group,b.group);
    const prf=a.prf&&b.prf?intersection(a.prf,b.prf):a.prf?.[0]??b.prf?.[0];
    if(encryption&&group&&(integrity||encryption.includes('gcm'))&&(!(a.prf&&b.prf)||prf)){
      agreed={encryption,integrity:integrity??'AEAD',group,prf};break;
    }
  }
  if(!agreed)return null;
  const set=first.sets.find(a=>second.sets.some(b=>a.mode===b.mode&&a.algorithms.join(' ')===b.algorithms.join(' '))&&
    (p.gre.mode!=='ipsec ipv4'||a.mode==='tunnel'));
  return set?{...agreed,esp:set.algorithms.join(' '),mode:set.mode}:null;
}

function cryptoShow(lab,d,args) {
  const rows=Object.entries(d.ports).filter(([,p])=>p.gre?.protection).flatMap(([port,p])=>
    tunnelPeers(lab,d,port,{includeShortcuts:true}).filter(row=>row.sa).map(row=>({port,p,...row})));
  if(args[2]==='session')return reply(rows.map(row=>'Interface: '+row.port+'  Peer: '+row.destination+'  Session status: UP-ACTIVE').join('\n')||'No active crypto sessions.');
  if(args[2]==='ikev2')return reply(rows.map(row=>'Peer '+row.destination+' · IKEv2 READY · '+row.sa.encryption+' / '+row.sa.integrity+' · DH '+row.sa.group).join('\n')||
    'No READY IKEv2 security association.');
  return reply(rows.map(row=>{
    const counters=own(row.p.gre.counters,row.destination)??{};
    return 'interface: '+row.port+'\n  local crypto endpoint: '+row.source+'  remote: '+row.destination+
      '\n  ESP '+row.sa.esp+' · '+row.sa.mode+'\n  #pkts encaps: '+(counters.encap??0)+'   #pkts decaps: '+(counters.decap??0);
  }).join('\n')||'No active IPsec security associations.');
}

export function ipsecCLI(lab,d,s,args,c) {
  if(c.startsWith('show crypto '))return cryptoShow(lab,d,args);
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [verb,topic,kind,name,...rest]=w;
  if(s.mode==='global'&&verb==='crypto'&&['ikev2','ipsec'].includes(topic)){
    if(!keyName(name))return invalid('Use a valid crypto object name.');
    const data=ipsec(d);
    const [table,mode]=topic==='ikev2'?[data[kind==='policy'?'policies':kind+'s'],ikeModes[kind]]:
      kind==='transform-set'?[data.transforms,'ipsecTransform']:[data.protections,'ipsecProfile'];
    if(no){delete table[name];return reply();}
    if(mode==='ipsecTransform'){
      if(!rest.length||rest.some(word=>!/^esp-(?:aes(?:-gcm)?|sha(?:256|384|512)?-hmac)$/.test(word)&&!['128','192','256'].includes(word)))
        return invalid('Use an ESP transform supported in LabSim.');
      table[name]={algorithms:rest,mode:table[name]?.mode??'tunnel'};
    }else table[name]??={};
    return enter(s,mode,name);
  }
  if(s.mode==='ikeProposal'){
    const row=own(d.ipsec?.proposals,s.current),values=w.slice(1);
    const valid=values.length&&(verb==='group'?values.every(x=>integer(x,1,32)):values.every(x=>/^[\w-]+$/.test(x)));
    if(!row||!valid)return invalid('Check the proposal transforms or DH groups.');
    row[verb]=values;return reply();
  }
  if(s.mode==='ikePolicy'){
    const row=own(d.ipsec?.policies,s.current);
    if(!row)return invalid('The IKEv2 policy no longer exists.');
    if(verb==='match'){row.anyVrf=true;return reply();}
    if(!no&&!own(d.ipsec.proposals,topic))return invalid('Create the named proposal first.');
    row.proposals=(row.proposals??[]).filter(key=>key!==topic);
    if(!no)row.proposals.push(topic);
    return reply();
  }
  if(s.mode==='ikeKeyring'){
    const ring=own(d.ipsec?.keyrings,s.current);
    if(!ring||!keyName(topic))return invalid('Use a valid peer name.');
    if(no){delete ring[topic];return reply();}
    ring[topic]??={};return enter(s,'ikePeer',{name:s.current,peer:topic},true);
  }
  if(s.mode==='ikePeer'){
    const row=own(own(d.ipsec?.keyrings,s.current.name),s.current.peer);
    if(!row)return invalid('This key-ring peer no longer exists.');
    if(verb==='address'){
      const length=kind?prefixLength(kind):32;
      if(ipv4(topic)===null||length===null)return invalid('Use a peer IPv4 address and optional wildcard-free subnet mask.');
      row.address=topic;row.prefix=length;return reply();
    }
    if(kind){row[topic]=kind;return reply();}
    row.local=topic;row.remote=topic;return reply();
  }
  if(s.mode==='ikeProfile'){
    const row=own(d.ipsec?.profiles,s.current);
    if(!row)return invalid('The IKEv2 identity profile no longer exists.');
    if(verb==='match'){
      const [address,mask]=rest;
      const prefix=mask?prefixLength(mask):32;
      if(ipv4(address)===null||prefix===null)return invalid('Use a valid IKE peer identity and mask.');
      row.remote={address,prefix};return reply();
    }
    if(verb==='authentication'){row[topic==='local'?'local':'remoteAuth']=kind;return reply();}
    if(own(d.ipsec.keyrings,kind)){row.keyring=kind;return reply();}
    return invalid('Create the referenced key ring first.');
  }
  if(s.mode==='ipsecTransform'){
    const row=own(d.ipsec?.transforms,s.current);
    if(!row)return invalid('The ESP transform no longer exists.');
    row.mode=topic;return reply();
  }
  if(s.mode==='ipsecProfile'){
    const row=own(d.ipsec?.protections,s.current);
    if(!row)return invalid('The IPsec profile no longer exists.');
    if(topic==='pfs'&&/^group\d{1,2}$/.test(kind)){row.pfs=kind;return reply();}
    if(topic==='transform-set'&&w.slice(2).every(name=>own(d.ipsec.transforms,name))){row.transforms=w.slice(2);return reply();}
    if(topic==='ikev2-profile'&&own(d.ipsec.profiles,kind)){row.ikev2=kind;return reply();}
    return invalid('Create the referenced ESP transform and IKEv2 profile first.');
  }
  return null;
}

export function ipsecRunning(d) {
  const data=d.ipsec;
  if(!data)return [];
  return [
    ...Object.entries(data.proposals).flatMap(([name,p])=>['crypto ikev2 proposal '+name,...Object.entries(p).map(([kind,values])=>' '+kind+' '+values.join(' '))]),
    ...Object.entries(data.policies).flatMap(([name,p])=>['crypto ikev2 policy '+name,...(p.proposals??[]).map(key=>' proposal '+key)]),
    ...Object.entries(data.keyrings).flatMap(([name,p])=>['crypto ikev2 keyring '+name,...Object.entries(p).flatMap(([peer,row])=>[
      ' peer '+peer,...(row.address?['  address '+row.address]:[]),...(row.local?['  pre-shared-key [configured]']:[])
    ])]),
    ...Object.entries(data.profiles).flatMap(([name,p])=>['crypto ikev2 profile '+name,...(p.remote?[' match identity remote address '+p.remote.address]:[]),
      ...(p.local?[' authentication local '+p.local]:[]),...(p.remoteAuth?[' authentication remote '+p.remoteAuth]:[]),...(p.keyring?[' keyring local '+p.keyring]:[])]),
    ...Object.entries(data.transforms).flatMap(([name,p])=>['crypto ipsec transform-set '+name+' '+p.algorithms.join(' '),' mode '+p.mode]),
    ...Object.entries(data.protections).flatMap(([name,p])=>['crypto ipsec profile '+name,
      ...(p.transforms?[' set transform-set '+p.transforms.join(' ')]:[]),...(p.ikev2?[' set ikev2-profile '+p.ikev2]:[]),...(p.pfs?[' set pfs '+p.pfs]:[])])
  ];
}
