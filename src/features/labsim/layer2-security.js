import { deviceById, linkUp } from './network.js';
import { interfaceName } from './ios.js';

export function layer2Config(device,port,args,parseVlans) {
  const no=args[0]==='no', words=no?args.slice(1):args;
  const dhcp=words[0]==='ip'&&words[1]==='dhcp'&&words[2]==='snooping';
  const arp=words[0]==='ip'&&words[1]==='arp'&&words[2]==='inspection';
  if(!dhcp&&!arp)return null;
  const p=port&&device.ports[port];
  device.l2security??={};
  const settings=device.l2security;
  if(p){
    if(words[3]==='trust')p[dhcp?'dhcpTrust':'arpTrust']=!no;
    return '';
  }
  if(dhcp&&!words[3]){settings.snoop=!no;return '';}
  if(words[3]==='vlan'){
    const list=parseVlans(words[4]);
    if(!list)return 'Use VLAN numbers and ranges such as 10,20-24.';
    const field=dhcp?'dhcpVlans':'arpVlans';
    const ids=new Set(settings[field]??[]);
    for(const id of list)if(no)ids.delete(id);else ids.add(id);
    settings[field]=[...ids].sort((a,b)=>a-b);
    return '';
  }
  return 'Check the Layer 2 security arguments.';
}

export function acceptsDhcpOffer(device,port,vlan) {
  const cfg=device.l2security;
  if(!cfg?.snoop||!cfg.dhcpVlans?.includes(vlan)||device.ports[port].dhcpTrust)return true;
  cfg.dhcpDropped=(cfg.dhcpDropped??0)+1;
  return false;
}

export function learnDhcp(device,port,vlan,client,ip) {
  const cfg=device.l2security;
  if(!cfg?.snoop||!cfg.dhcpVlans?.includes(vlan)||device.ports[port].dhcpTrust)return;
  cfg.bindings??={};
  cfg.bindings[client.id]={port,vlan,ip};
}

export function inspectArp(device,port,vlan,client) {
  const cfg=device.l2security;
  const check=client.type==='pc'||client.type==='phone'||client.type==='ap';
  if(!check||!cfg?.arpVlans?.includes(vlan)||device.ports[port].arpTrust)return true;
  const binding=cfg.bindings?.[client.id];
  if(binding?.ip===(client.host.lease?.ip??client.host.ip)&&binding?.port===port&&binding?.vlan===vlan)return true;
  cfg.arpDropped=(cfg.arpDropped??0)+1;
  return false;
}

export function layer2Show(lab,device,args) {
  const dhcp=args[2]==='dhcp';
  const cfg=device.l2security;
  if(args[4]==='binding'){
    return Object.entries(cfg?.bindings??{}).flatMap(([id,entry])=>{
      const client=deviceById(lab,id);
      return client?.host.lease?.ip===entry.ip&&linkUp(lab,device,entry.port)?[`${client.name}  ${entry.ip}  VLAN ${entry.vlan}  ${entry.port}`]:[];
    }).join('\n')||'No DHCP snooping bindings.';
  }
  if(args[4]==='statistics')return 'Dropped '+(dhcp?'DHCP offers: '+(cfg?.dhcpDropped??0):'ARP checks: '+(cfg?.arpDropped??0));
  if(args[4]==='interfaces'){
    const name=args.length>5?interfaceName(args.slice(5)):null;
    const ports=Object.entries(device.ports).filter(([key])=>args.length===5||key===name);
    return ports.length?['Interface   Trust   Link',...ports.map(([key,p])=>key+'  '+(p.arpTrust?'Trusted':'Untrusted')+'  '+(linkUp(lab,device,key)?'up':'down'))].join('\n'):'% This interface is not present.';
  }
  const field=dhcp?'dhcpTrust':'arpTrust';
  const trusted=Object.entries(device.ports).filter(([,p])=>p[field]).map(([port])=>port).join(', ')||'none';
  return dhcp
    ?`DHCP snooping: ${cfg?.snoop?'enabled':'disabled'}\nVLANs: ${cfg?.dhcpVlans?.join(', ')||'none'}\nTrusted ports: ${trusted}`
    :`ARP inspection VLANs: ${cfg?.arpVlans?.join(', ')||'none'}\nTrusted ports: ${trusted}`;
}

export function layer2Running(device) {
  const cfg=device.l2security;
  return [...(cfg?.snoop?['ip dhcp snooping']:[]),
    ...(cfg?.dhcpVlans?.length?['ip dhcp snooping vlan '+cfg.dhcpVlans.join(',')]:[]),
    ...(cfg?.arpVlans?.length?['ip arp inspection vlan '+cfg.arpVlans.join(',')]:[])];
}
