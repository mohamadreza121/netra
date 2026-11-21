import { dotted, inSubnet, ipv4, mask, networkAddress, prefixLength } from './network.js';
import { interfaceName } from './ios.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

export const vrfIOS={
  operational:['show vrf [<name>]','show vrf interface <interface...>','show ip vrf [<name>]','show ip vrf interfaces',
    'show ip route vrf <name> [<address-or-protocol>]','ping vrf <name> <address> [source <address-or-interface...>]',
    'traceroute vrf <name> <address>','ping <address> source <address-or-interface...>'],
  global:['vrf definition <name>','no vrf definition <name>','ip vrf <name>','no ip vrf <name>',
    'ip route vrf <name> <network> <mask> <next-hop> [<distance>]','no ip route vrf <name> <network> <mask> <next-hop> [<distance>]'],
  interface:['vrf forwarding <name>','no vrf forwarding [<name>]','ip vrf forwarding <name>','no ip vrf forwarding [<name>]'],
  vrf:['rd <asn-or-ip:number>','no rd','address-family ipv4'],
  vrfAf:['exit-address-family']
};

const isName=name=>keyName(name)&&name.toLowerCase()!=='global';
function routeDistinguisher(raw) {
  const [first,last,extra]=raw?.split(':')??[];
  const long=ipv4(first)!==null||Number(first)>65535;
  return !extra&&(ipv4(first)!==null||integer(first,0,4294967295))&&integer(last,0,long?65535:4294967295);
}

export function setStaticRoute(d,args,vrf) {
  const no=args[0]==='no', start=(no?3:2)+(vrf?2:0);
  const terms=args.slice(start);
  const trackAt=terms.indexOf('track'),track=trackAt>=0?terms[trackAt+1]:undefined;
  const [destination,routeMask,via,ad]=(trackAt>=0?terms.slice(0,trackAt):terms);
  const prefix=prefixLength(routeMask?.replace(/^\//,''));
  const next=ipv4(via)!==null?via:undefined;
  const port=next?undefined:interfaceName([via]);
  const distance=Number(ad??1);
  if(ipv4(destination)===null||prefix===null||!next&&(!d.ports[port]||d.ports[port].vrf!==vrf)||!integer(ad??'1',1,254)||track&&!integer(track,1,1000))
    return invalid('Use ip route '+(vrf?'vrf NAME ':'')+'NETWORK MASK NEXT-HOP [DISTANCE].');
  if(next&&Object.values(d.ports).some(p=>p.vrf===vrf&&p.address===next))return invalid('Next hop belongs to this device in this VRF.');
  if(networkAddress(destination,prefix)!==destination)return invalid('Prefix and mask are inconsistent.');
  d.routes=d.routes.filter(r=>r.vrf!==vrf||r.destination!==destination||r.prefix!==prefix||r.next!==next||r.port!==port||ad&&r.distance!==distance||no&&track&&r.track!==track);
  if(!no)d.routes.push({destination,prefix,next,port,distance,vrf,track});
  return reply();
}

export function vrfPort(d,name,args,c) {
  if(!/^(?:no )?(?:ip )?vrf forwarding/.test(c))return null;
  const no=args[0]==='no';
  const port=d.ports[name];
  if(d.type==='switch'&&!name.startsWith('Vlan')&&port.mode!=='routed')return invalid('Use no switchport before assigning a Layer 3 VRF.');
  const vrf=no?undefined:args.at(-1);
  if(!no&&!own(d.vrfs,vrf))return invalid('Create the named VRF before assigning an interface.');
  if(port.vrf!==vrf){
    if(vrf)port.vrf=vrf;else delete port.vrf;
    delete port.address;delete port.prefix;delete port.ipv6;delete port.ipv6Enabled;
  }
  return reply();
}

export function vrfCLI(d,s,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  if(s.mode==='global'&&(w[0]==='vrf'&&w[1]==='definition'||w[0]==='ip'&&w[1]==='vrf')){
    const name=w[2];
    if(!isName(name))return invalid('Use a valid VRF name.');
    const table=d.vrfs??={};
    if(no){
      delete table[name];
      d.routes=d.routes.filter(r=>r.vrf!==name);
      for(const p of Object.values(d.ports))if(p.vrf===name){
        delete p.vrf;delete p.address;delete p.prefix;delete p.ipv6;delete p.ipv6Enabled;
      }
      return reply();
    }
    table[name]??={legacy:w[0]==='ip'};
    return enter(s,'vrf',name);
  }
  if(s.mode==='global'&&w[0]==='ip'&&w[1]==='route'&&w[2]==='vrf'){
    if(!own(d.vrfs,w[3]))return invalid('This VRF does not exist.');
    return setStaticRoute(d,args,w[3]);
  }
  if(s.mode==='vrf'){
    const table=own(d.vrfs,s.current);
    if(!table)return invalid('This VRF no longer exists.');
    if(w[0]==='rd'){
      if(no)delete table.rd;
      else if(routeDistinguisher(w[1]))table.rd=w[1];
      else return invalid('Use an RD such as 65000:10 or 192.0.2.1:10.');
      return reply();
    }
    if(w[0]==='address-family'){table.ipv4=true;return enter(s,'vrfAf',s.current,true);}
  }
  if(s.mode==='vrfAf'&&c==='exit-address-family'){
    s.parents?.pop();return enter(s,'vrf',s.current);
  }
  if(c.startsWith('show vrf')||c.startsWith('show ip vrf')){
    const token=args[1]==='vrf'?args[2]:args[3];
    const interfaceFilter=token==='interface'?interfaceName(args.slice(3)):null;
    const table=Object.entries(d.vrfs??{}).filter(([name])=>!token||['interfaces','interface'].includes(token)||token===name);
    return reply(table.map(([name,row])=>{
      const ports=Object.entries(d.ports).filter(([key,p])=>p.vrf===name&&(token!=='interface'||key===interfaceFilter));
      if(token==='interfaces'||token==='interface')return ports.map(([key,p])=>key+'  '+(p.address??'unassigned')+'  '+name).join('\n');
      return name+'  RD '+(row.rd??'<not set>')+'  '+(ports.map(([key])=>key).join(', ')||'No interfaces');
    }).filter(Boolean).join('\n')||'No matching VRF entries.');
  }
  if(c.startsWith('show ip route vrf ')&&!own(d.vrfs,args[4]))return invalid('This VRF does not exist.');
  return null;
}

export function vrfRunning(d) {
  return Object.entries(d.vrfs??{}).flatMap(([name,row])=>[
    (row.legacy?'ip vrf ':'vrf definition ')+name,...(row.rd?[' rd '+row.rd]:[]),...(row.ipv4?[' address-family ipv4']:[])
  ]);
}

export const staticLine=r=>'ip route '+(r.vrf?'vrf '+r.vrf+' ':'')+r.destination+' '+dotted(mask(r.prefix))+' '+(r.next??r.port)+(r.distance!==1?' '+r.distance:'')+(r.track?' track '+r.track:'');
