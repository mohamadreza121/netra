import { ipv4, linkUp, transaction } from './network.js';
import { interfaceName } from './ios.js';
import { integer, invalid, reply } from './cli-utils.js';

export const greIOS={
  operational:['show tunnel interface <interface...>','show ip interface brief'],
  interface:['tunnel source <interface-or-address...>','no tunnel source','tunnel destination <address>','no tunnel destination',
    'tunnel mode gre ip','tunnel key <number>','no tunnel key','keepalive <seconds> <retries>','no keepalive']
};
const isTunnel=name=>name?.startsWith('Tu');

function localSource(lab,d,p) {
  const configured=p.gre?.source;
  if(!configured)return null;
  const found=Object.entries(d.ports).find(([name,port])=>!isTunnel(name)&&!port.vrf&&port.address&&
    (name===configured||port.address===configured)&&linkUp(lab,d,name));
  return found?.[1].address??null;
}

export function tunnelState(lab,d,name) {
  const p=d.ports[name];
  if(!p?.up||!p.gre?.destination||p.vrf)return null;
  const source=localSource(lab,d,p);
  if(!source||source===p.gre.destination)return null;
  const destination=p.gre.destination;
  const hit=transaction(lab,d,destination,{sourceAddress:source,wiredOnly:true,baseOnly:true,noTunnels:true,packet:{protocol:'gre'}});
  if(!hit.ok)return null;
  const remote=Object.entries(hit.destination.ports).find(([port,settings])=>
    isTunnel(port)&&settings.up&&!settings.vrf&&settings.gre?.destination===source&&settings.gre.key===p.gre.key&&localSource(lab,hit.destination,settings)===destination);
  return remote?{device:hit.destination,port:remote[0],path:hit.path,source,destination}:null;
}

export function grePort(d,name,args,c) {
  if(!/^(?:no )?(?:tunnel |keepalive)/.test(c))return null;
  if(d.type!=='router'||!isTunnel(name))return invalid('Use a router tunnel interface.');
  const no=args[0]==='no',w=no?args.slice(1):args;
  const p=d.ports[name],gre=p.gre??={};
  if(w[0]==='keepalive'){
    if(no)delete gre.keepalive;
    else if(integer(w[1],1,32767)&&integer(w[2],1,255))gre.keepalive=[Number(w[1]),Number(w[2])];
    else return invalid('Check the GRE keepalive interval and retry count.');
    return reply();
  }
  const [,option,value]=w;
  if(no){delete gre[option];return reply();}
  if(option==='mode'){gre.mode='gre ip';return reply();}
  if(option==='destination'&&ipv4(value)!==null){gre.destination=value;return reply();}
  if(option==='key'&&integer(value,0,4294967295)){gre.key=Number(value);return reply();}
  if(option==='source'){
    const port=interfaceName(w.slice(2));
    if(ipv4(value)!==null||d.ports[port]&&!isTunnel(port)){gre.source=d.ports[port]?port:value;return reply();}
  }
  return invalid('Check the GRE IPv4 endpoint or tunnel key.');
}

export function greShow(lab,d,args,c) {
  if(!c.startsWith('show tunnel interface '))return null;
  const name=interfaceName(args.slice(3));
  const p=d.ports[name];
  if(!p||!isTunnel(name))return invalid('Select an existing tunnel interface.');
  const state=tunnelState(lab,d,name);
  return reply(name+' is '+(p.up?'up':'administratively down')+', line protocol is '+(state?'up':'down')+
    '\n  Tunnel source '+(state?.source??p.gre?.source??'unconfigured')+', destination '+(p.gre?.destination??'unconfigured')+
    '\n  Tunnel protocol/transport GRE/IP'+(p.gre?.key!==undefined?' · Key '+p.gre.key:'')+
    (state?'\n  Underlay: '+state.path.map(id=>lab.devices.find(d=>d.id===id)?.name).join(' → '):'\n  Check underlay routing, matching endpoints and key.'),state?.path);
}

export function greRunning(p) {
  return [
    ...['source','destination','mode','key'].filter(name=>p.gre?.[name]!==undefined).map(name=>' tunnel '+name+' '+p.gre[name]),
    ...(p.gre?.keepalive?[' keepalive '+p.gre.keepalive.join(' ')]:[])
  ];
}
