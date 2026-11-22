import { bgpSnapshot, bgpVpnFamily, bgpRouterId } from './bgp.js';
import { deviceById, inSubnet, ipv4Underlay, linkUp, segment } from './network.js';
import { interfaceName } from './ios.js';
import { applyPolicy, routeKey } from './route-policy.js';
import { invalid, own, reply } from './cli-utils.js';

export const mplsIOS={
  operational:['show mpls interfaces','show mpls ldp neighbor [detail]','show mpls ldp bindings [<prefix>]',
    'show mpls forwarding-table [<prefix>]','show bgp vpnv4 unicast all [<prefix>]','show bgp vpnv4 unicast all summary',
    'show bgp vpnv4 unicast vrf <name> [<prefix>]'],
  global:['mpls label protocol ldp','mpls ldp router-id <interface> [force]','mpls ip','no mpls ip'],
  interface:['mpls ip','no mpls ip']
};

const enabled=(d,port)=>d.mpls?.enabled!==false&&d.ports[port]?.mpls&&d.ports[port]?.address&&!d.ports[port].vrf;
const ldpId=d=>d.ports[d.mpls?.routerId]?.address??bgpRouterId(d);
const routeLabel=(d,key,base=16)=>{
  const hash=[...(d.id+'|'+key)].reduce((value,ch)=>(value*31+ch.charCodeAt(0))>>>0,0);
  return base+(hash%10000);
};

function ldpLinks(lab,d,port) {
  if(!enabled(d,port)||!linkUp(lab,d,port))return [];
  const here=d.ports[port];
  return segment(lab,d,port,false,'control').filter(({device,port:remote})=>{
    if(!enabled(device,remote)||!device.ports[remote]?.address)return false;
    const far=device.ports[remote];
    return inSubnet(far.address,here.address,here.prefix)&&inSubnet(here.address,far.address,far.prefix)&&ldpId(d)!==ldpId(device);
  });
}

function lsp(lab,d,target) {
  let node=d;
  const path=[d.id],labels=[];
  let port;
  while(!Object.entries(node.ports).some(([key,p])=>p.address===target&&!p.vrf&&linkUp(lab,node,key))){
    const route=ipv4Underlay(lab,node).find(r=>inSubnet(target,r.destination,r.prefix));
    if(!route)return null;
    const hit=ldpLinks(lab,node,route.port).find(link=>link.device.ports[link.port].address===(route.next??target));
    if(!hit||path.includes(hit.device.id))return null;
    port??=route.port;
    labels.push(routeLabel(hit.device,target));
    node=hit.device;path.push(node.id);
  }
  return {path,labels,port,peer:node.id};
}

function localVpn(lab,d) {
  return Object.entries(d.vrfs??{}).flatMap(([name,vrf])=>{
    const bgp=own(d.bgp?.families,'ipv4 '+name);
    if(!bgp||!vrf.rd||!vrf.targets?.export?.length)return [];
    return ipv4Underlay(lab,d,name).flatMap(r=>{
      const network=bgp.networks.some(n=>routeKey(n)===routeKey(r));
      const policy=own(bgp.redistribute,r.protocol);
      if(!network&&(!policy||policy.process!==undefined&&policy.process!==r.process))return [];
      const advertised=applyPolicy(d,network?undefined:policy.map,r);
      if(!advertised)return [];
      return [{...advertised,vrf:name,rd:vrf.rd,targets:vrf.targets.export,label:routeLabel(d,vrf.rd+' '+routeKey(r),16000)}];
    });
  });
}

function receivedVpn(lab,d) {
  if(!bgpVpnFamily(d))return [];
  const sessions=bgpSnapshot(lab,ipv4Underlay,'vpnv4').get(d.id)?.sessions??[];
  return sessions.flatMap(session=>{
    if(!session.remote||!['extended','both'].includes(session.reverse['send-community']))return [];
    const path=lsp(lab,d,session.address);
    return localVpn(lab,session.remote).map(row=>({...row,remote:session.remote,next:session.address,transport:path}));
  });
}

export function vpnRoutes(lab,d,vrfName) {
  const vrf=own(d.vrfs,vrfName);
  if(!vrf?.targets?.import?.length)return [];
  return receivedVpn(lab,d).flatMap(row=>{
    if(!row.transport||!row.targets.some(target=>vrf.targets.import.includes(target)))return [];
    return [{...row,distance:200,protocol:'bgp',port:row.transport.port,metric:0,
      vpn:{remote:row.remote.id,vrf:row.vrf,path:row.transport.path,labels:[...row.transport.labels,row.label]}}];
  });
}

export function mplsPort(d,p,args,c) {
  if(c!=='mpls ip'&&c!=='no mpls ip')return null;
  if(d.type==='switch'&&p.mode!=='routed')return invalid('Enable MPLS on a routed core interface.');
  if(p.vrf)return invalid('Use a provider core link outside the customer VRF.');
  p.mpls=args[0]!=='no';
  return reply();
}

export function mplsCLI(lab,d,s,args,c) {
  if(s.mode==='global'&&/^(?:no )?mpls /.test(c)){
    const cfg=d.mpls??={};
    if(c==='mpls ip'||c==='no mpls ip'){cfg.enabled=args[0]!=='no';return reply();}
    if(c==='mpls label protocol ldp'){cfg.protocol='ldp';return reply();}
    if(c.startsWith('mpls ldp router-id ')){
      const name=interfaceName([args[3]]);
      if(!d.ports[name]?.address)return invalid('Choose an IPv4 interface for the LDP router ID.');
      cfg.routerId=name;return reply();
    }
  }
  if(c==='show mpls interfaces'){
    return reply(Object.keys(d.ports).filter(port=>d.ports[port].mpls).map(port=>
      port+'  '+(enabled(d,port)&&linkUp(lab,d,port)?'Operational':'Down')+'  LDP').join('\n')||'No MPLS interfaces.');
  }
  if(c.startsWith('show mpls ldp neighbor')){
    return reply(Object.keys(d.ports).flatMap(port=>ldpLinks(lab,d,port).map(({device,port:remote})=>
      'Peer LDP Ident: '+ldpId(device)+':0 · Oper · '+port+' → '+device.name+' '+remote)).join('\n')||'No operational LDP neighbors.');
  }
  if(c.startsWith('show mpls ldp bindings')||c.startsWith('show mpls forwarding-table')){
    const bindings=args[2]==='ldp',filter=args[bindings?4:3],underlay=ipv4Underlay(lab,d);
    const rows=underlay.filter(row=>!filter||filter===routeKey(row)||filter===row.destination).flatMap(row=>{
      const from=row.destination===row.next?row.next:row.destination;
      if(row.protocol==='connected'){
        if(!bindings||!Object.keys(d.ports).some(port=>ldpLinks(lab,d,port).length))return [];
        return [routeKey(row)+'  Local binding: implicit-null'];
      }
      const labelPath=lsp(lab,d,from);
      if(!labelPath)return [];
      return [routeKey(row)+'  Local '+routeLabel(d,from)+'  Outgoing '+(labelPath.labels[0]??'implicit-null')+'  '+row.port+'  '+(row.next??'direct')];
    });
    return reply(rows.join('\n')||'No matching label bindings.');
  }
  if(c.startsWith('show bgp vpnv4')){
    if(args[5]==='summary'){
      const sessions=bgpSnapshot(lab,ipv4Underlay,'vpnv4').get(d.id)?.sessions??[];
      return reply(sessions.map(s=>s.address+'  AS '+s.asn+'  '+s.state).join('\n')||'No VPNv4 peer sessions.');
    }
    const vrf=args[4]==='vrf'?args[5]:undefined,filter=args[vrf?6:5];
    if(vrf&&!own(d.vrfs,vrf))return invalid('This VRF does not exist.');
    const candidates=vrf?vpnRoutes(lab,d,vrf):[...localVpn(lab,d),...receivedVpn(lab,d)];
    return reply(candidates.filter(row=>!filter||routeKey(row)===filter||row.destination===filter).map(row=>
      'RD '+row.rd+'  '+routeKey(row)+'  '+(row.next??'local')+'  RT '+row.targets.join(',')+'  VPN label '+row.label+
      (row.transport?'  transport '+row.transport.labels.join('/'):'')).join('\n')||'No matching VPNv4 prefixes.');
  }
  return null;
}

export function mplsRunning(d) {
  return [
    ...(d.mpls?.enabled!==undefined?[d.mpls.enabled?'mpls ip':'no mpls ip']:[]),
    ...(d.mpls?.protocol?['mpls label protocol '+d.mpls.protocol]:[]),
    ...(d.mpls?.routerId?['mpls ldp router-id '+d.mpls.routerId]:[])
  ];
}
