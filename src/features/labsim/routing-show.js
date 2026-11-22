import { ipv4, linkUp, networkAddress, routeTable, inSubnet } from './network.js';
import { ospfInterfaces, ospfNeighbors, ospfSnapshot, routerId } from './ospf.js';
import { interfaceName } from './ios.js';
import { invalid, reply } from './cli-utils.js';

const routeLegend=[
  'Codes: L - local, C - connected, S - static, B - BGP',
  '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
  '       E1 - OSPF external type 1, E2 - OSPF external type 2, * - candidate default'
];
const codes={local:'L',connected:'C',static:'S',ospf:'O',bgp:'B',eigrp:'D'};
const routeType={local:'connected',connected:'connected',static:'static',ospf:'ospf',bgp:'bgp',eigrp:'eigrp'};
const routePrefix=r=>r.destination+'/'+r.prefix;
function routeLine(r) {
  const type=r.protocol==='ospf'?r.ospfType:r.protocol==='eigrp'&&r.external?'EX':'';
  const code=(codes[r.protocol]??'?')+(type?' '+type:'')+(r.prefix===0?'*':'');
  const attached=r.protocol==='local'||r.protocol==='connected';
  const metric='['+r.distance+'/'+(r.metric??0)+']';
  return code.padEnd(8)+routePrefix(r)+' '+(attached?'is directly connected, '+r.port:r.next?
    metric+' via '+r.next+(r.port?', '+r.port:''):metric+' is directly connected, '+r.port);
}

export function showIPv4Routes(lab,d,args) {
  const vrf=args[3]==='vrf'?args[4]:undefined,query=args[vrf?5:3]?.toLowerCase();
  if(vrf&&!Object.hasOwn(d.vrfs??{},vrf))return invalid('This VRF does not exist.');
  const base=routeTable(lab,d,vrf);
  const all=[...base,...base.filter(row=>row.protocol==='connected'&&row.prefix<32).map(row=>({
    ...row,protocol:'local',destination:d.ports[row.port].address,prefix:32
  }))].sort((a,b)=>b.prefix-a.prefix||ipv4(a.destination)-ipv4(b.destination));
  const isAddress=ipv4(query)!==null;
  if(isAddress){
    const row=all.find(r=>inSubnet(query,r.destination,r.prefix));
    if(!row)return reply('% Network not in table');
    return reply([
      'Routing entry for '+routePrefix(row),
      '  Known via "'+(routeType[row.protocol]??row.protocol)+'", distance '+row.distance+', metric '+(row.metric??0),
      ...(row.ospfType?['  Route type: '+({IA:'inter area',E1:'external type 1',E2:'external type 2'}[row.ospfType]??row.ospfType)]:[]),
      ...(row.tag!==undefined?['  Route tag '+row.tag]:[]),
      '  Routing Descriptor Blocks:',
      '  * '+(row.next?row.next+', via '+row.port:'directly connected, via '+row.port),
      '    '+routeLine(row).trim()
    ].join('\n'));
  }
  if(query==='summary'){
    const protocols=['connected','local','static','ospf','eigrp','bgp'];
    return reply(['Route Source          Networks  Host routes  Total',
      ...protocols.map(protocol=>{
        const matches=all.filter(row=>row.protocol===protocol),hosts=matches.filter(row=>row.prefix===32).length;
        return protocol.padEnd(22)+String(matches.length-hosts).padEnd(10)+String(hosts).padEnd(13)+matches.length;
      }),'Total routes: '+all.length].join('\n'));
  }
  const selected=query?all.filter(r=>r.protocol===query):all;
  if(query)return reply(selected.length?selected.map(routeLine).join('\n'):'No active routes.');
  const lastResort=base.find(row=>row.prefix===0);
  return reply([
    ...(vrf?['Routing Table: '+vrf,'']:[]),...routeLegend,'',
    lastResort?'Gateway of last resort is '+(lastResort.next??lastResort.port)+' to network 0.0.0.0':'Gateway of last resort is not set',
    '',...(all.length?all.map(routeLine):['No active routes.'])
  ].join('\n'));
}

export function showIPProtocols(lab,d) {
  const sections=[];
  if(d.ospf){
    const cfg=d.ospf,local=ospfInterfaces(lab,d);
    const passive=[...new Set([...local.filter(row=>row.passive).map(row=>row.port),
      ...Object.keys(cfg.passive).filter(port=>cfg.passive[port])])];
    const neighbors=ospfNeighbors(lab,d,ospfSnapshot(lab));
    sections.push([
      'Routing Protocol is "ospf '+cfg.id+'"','  Router ID '+(routerId(d)??'unassigned'),
      '  Number of areas in this router: '+new Set(local.map(row=>row.area)).size,
      '  Maximum path: '+(cfg.maximumPaths??4),'  Routing for Networks:',
      ...(cfg.networks.length?cfg.networks.map(row=>'    '+row.address+' '+row.wildcard+' area '+(row.area??0)):['    None']),
      '  Passive Interface(s): '+(passive.join(', ')||'None'),'  Routing Information Sources:',
      ...(neighbors.length?[...new Set(neighbors.map(row=>routerId(row.device)))].map(id=>'    '+id+'  110'):['    None']),
      '  Distance: (default is 110)'
    ].join('\n'));
  }
  if(d.eigrp?.asn)sections.push(['Routing Protocol is "eigrp '+d.eigrp.asn+'"',
    ...d.eigrp.networks.map(r=>'  Network '+r.address+' '+r.wildcard),'  Distance: internal 90, external 170'].join('\n'));
  if(d.bgp)sections.push(['Routing Protocol is "bgp '+d.bgp.asn+'"',
    ...Object.entries(d.bgp.neighbors).map(([ip,n])=>'  Neighbor '+ip+' remote AS '+n.asn),'  Distance: external 20, internal 200'].join('\n'));
  return reply(sections.join('\n\n')||'No dynamic IPv4 routing protocols configured.');
}

export function showOSPF(lab,d,args) {
  const cfg=d.ospf;
  if(!cfg)return reply('OSPF is not configured.');
  const snapshot=ospfSnapshot(lab);
  const local=snapshot.get(d.id)??[],id=routerId(d)??'unassigned';
  const neighbors=ospfNeighbors(lab,d,snapshot);
  function election(row){
    if(row.network!=='broadcast'||row.passive||row.port.startsWith('Lo'))return [];
    return [{device:d,remote:row},...neighbors.filter(n=>n.local.port===row.port)].filter(n=>n.remote.priority>0)
      .sort((a,b)=>b.remote.priority-a.remote.priority||ipv4(routerId(b.device))-ipv4(routerId(a.device))).slice(0,2);
  }
  function role(device,leaders) {
    return leaders[0]?.device===device?'DR':leaders[1]?.device===device?'BDR':'DROTHER';
  }
  if(args[3]==='neighbor'){
    if(!neighbors.length)return reply('No FULL adjacencies.');
    const detail=args[4]==='detail';
    const body=neighbors.map(n=>{
      const leaders=election(n.local);
      const state=n.local.network==='broadcast'?((leaders.some(row=>row.device===n.device||row.device===d)?'FULL':'2WAY')+'/'+role(n.device,leaders)):'FULL/-';
      const neighbor=routerId(n.device);
      return detail?[
        'Neighbor '+neighbor+', interface address '+n.remote.address,
        '  In the area '+n.local.area+' via interface '+n.local.port,
        '  Neighbor priority is '+n.remote.priority+', State is '+state,
        '  Configured Hello '+n.local.hello+' sec, Dead '+n.local.dead+' sec'
      ].join('\n'):[neighbor.padEnd(18),String(n.remote.priority).padEnd(5),state.padEnd(16),n.remote.address.padEnd(17),n.local.port].join('');
    });
    return reply(detail?body.join('\n\n'):['Neighbor ID       Pri  State           Address          Interface',...body].join('\n'));
  }
  if(args[3]==='interface'){
    const brief=args[4]==='brief',specific=args[4]&&!brief;
    const name=specific?interfaceName(args.slice(4)):null;
    if(specific&&!Object.hasOwn(d.ports,name))return invalid('This interface does not exist.');
    const selected=local.filter(row=>!specific||row.port===name);
    if(!selected.length)return reply('No active OSPF interfaces.');
    const output=selected.map(row=>{
      const leaders=election(row),count=neighbors.filter(n=>n.local.port===row.port).length;
      const state=row.port.startsWith('Lo')?'LOOP':row.passive?'PASSIVE':row.network==='point-to-point'?'P2P':role(d,leaders);
      if(brief)return [
        row.port.padEnd(14),String(cfg.id).padEnd(7),String(row.area).padEnd(7),
        (row.address+'/'+row.prefix).padEnd(20),String(row.cost).padEnd(7),state.padEnd(9),count
      ].join('');
      return [
        row.port+' is '+(linkUp(lab,d,row.port)?'up, line protocol is up':'down, line protocol is down'),
        '  Internet Address '+row.address+'/'+row.prefix+', Area '+row.area,
        '  Process ID '+cfg.id+', Router ID '+id+', Network Type '+row.network.toUpperCase().replaceAll('-','_')+', Cost: '+row.cost,
        '  State '+state+', Priority '+row.priority,
        ...(leaders.length?['  Designated Router (ID) '+routerId(leaders[0].device)+', Interface address '+leaders[0].remote.address]:[]),
        ...(leaders[1]?['  Backup Designated Router (ID) '+routerId(leaders[1].device)+', Interface address '+leaders[1].remote.address]:[]),
        '  Timer intervals configured, Hello '+row.hello+', Dead '+row.dead,'  Neighbor Count is '+count
      ].join('\n');
    });
    return reply(brief?['Interface     PID    Area   IP Address/Mask     Cost   State    Nbrs',...output].join('\n'):output.join('\n\n'));
  }
  if(args[3]==='database'){
    const routes=routeTable(lab,d).filter(r=>r.protocol==='ospf');
    return reply(['OSPF Router with ID ('+id+') (Process ID '+cfg.id+')',
      'Reachable OSPF advertisements in this lab',...routes.map(r=>routePrefix(r)+' via '+r.next+' metric '+r.metric)].join('\n'));
  }
  const areas=[...new Set(local.map(row=>row.area))];
  return reply(['Routing Process "ospf '+cfg.id+'" with ID '+id,
    '  Reference bandwidth unit is '+(cfg.reference??100)+' mbps','  Number of areas in this router is '+areas.length,
    ...areas.map(area=>'    Area '+(area===0?'BACKBONE(0)':area)+' · '+local.filter(row=>row.area===area).length+' interface(s)')
  ].join('\n'));
}
