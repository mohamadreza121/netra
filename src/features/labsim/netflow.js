import { ipv4, linkUp, transaction } from './network.js';
import { interfaceName } from './ios.js';
import { enter, integer, invalid, keyName, own, reply } from './cli-utils.js';

const recordFields={
  'ipv4 source address':'source','ipv4 destination address':'destination','ipv4 protocol':'protocol',
  'transport source-port':'sourcePort','transport destination-port':'destinationPort','interface input':'input',
  'interface output':'output','counter bytes':'bytes','counter packets':'packets',
  'timestamp sys-uptime first':'first','timestamp sys-uptime last':'last'
};
export const netflowIOS={
  operational:['show flow exporter [<name>]','show flow monitor [<name>]','show flow monitor <name> cache [format table]','show flow record [<name>]'],
  global:['flow record <name>','no flow record <name>','flow exporter <name>','no flow exporter <name>','flow monitor <name>','no flow monitor <name>'],
  interface:['ip flow monitor <name> input','ip flow monitor <name> output','no ip flow monitor <name> input','no ip flow monitor <name> output'],
  flowRecord:['description <text...>',...Object.keys(recordFields).map(key=>
    (key.startsWith('counter')||key.startsWith('timestamp')||key==='interface output'?'collect ':'match ')+key+(key.startsWith('counter')?' [long]':''))],
  flowExporter:['description <text...>','destination <address>','source <interface...>','transport udp <port>','export-protocol netflow-v9','export-protocol ipfix'],
  flowMonitor:['description <text...>','record <name>','exporter <name>','no exporter <name>','cache timeout active <seconds>','cache timeout inactive <seconds>']
};
const collections={record:'records',exporter:'exporters',monitor:'monitors'};
const fields={source:'Source',destination:'Destination',protocol:'Protocol',sourcePort:'Src port',destinationPort:'Dst port',
  input:'Ingress',output:'Egress',bytes:'Bytes',packets:'Packets',first:'First',last:'Last'};
const modes={record:'flowRecord',exporter:'flowExporter',monitor:'flowMonitor'};
const config=d=>d.flow??={records:{},exporters:{},monitors:{}};
const direction=w=>w.at(-1);

export function flowPort(d,p,args,c) {
  if(!c.includes('ip flow monitor '))return null;
  const no=args[0]==='no',name=args[no?4:3],key=direction(args);
  const entry=own(d.flow?.monitors,name);
  if(!no&&(!entry?.record||!own(d.flow.records,entry.record)?.match.length))return invalid('Configure a monitor and a record with match fields first.');
  p.monitors??={};
  if(no){if(p.monitors[key]===name)delete p.monitors[key];}
  else p.monitors[key]=name;
  return reply();
}

function expiry(row,monitor,now) {
  return now-row.last>(monitor.inactive??15)*1000||now-row.first>(monitor.active??1800)*1000;
}
const fresh=(monitor,now)=>Object.entries(monitor.cache??{}).filter(([,row])=>!expiry(row,monitor,now));
const display=(key,value)=>value===undefined?'—':['first','last'].includes(key)?new Date(value).toISOString():String(value);

export function flowCLI(lab,d,s,args,c) {
  const no=args[0]==='no',w=no?args.slice(1):args;
  const [verb,type,name]=w;
  if(c.startsWith('show flow ')){
    const kind=w[2],title=w[3],rows=Object.entries(d.flow?.[collections[kind]]??{}).filter(([key])=>!title||key===title);
    if(w[4]==='cache'){
      const monitor=rows[0]?.[1], record=own(d.flow?.records,monitor?.record);
      const entries=monitor?fresh(monitor,Date.now()).map(([,row])=>row):[];
      if(!record||!entries.length)return reply('No flow cache entries.');
      const keys=[...new Set([...record.match,...record.collect])];
      return reply([keys.map(k=>fields[k]).join('  '),...entries.map(row=>keys.map(k=>display(k,row[k])).join('  '))].join('\n'));
    }
    return reply(rows.map(([key,row])=>{
      if(kind==='record')return key+' · Match '+row.match.map(k=>fields[k]).join(', ')+' · Collect '+row.collect.map(k=>fields[k]).join(', ');
      if(kind==='exporter')return key+' · '+(row.destination??'unconfigured')+':'+(row.port??2055)+' · '+(row.protocol??'netflow-v9')+' · Records exported: '+(row.exported??0);
      return key+' · Record '+(row.record??'unconfigured')+' · Exporters '+row.exporters.join(', ')+' · Cache '+fresh(row,Date.now()).length;
    }).join('\n')||'No matching flow configuration.');
  }
  if(s.mode==='global'&&verb==='flow'){
    if(!keyName(name))return invalid('Use a valid flow object name.');
    const store=config(d)[collections[type]];
    if(no){delete store[name];return reply();}
    store[name]??=type==='record'?{match:[],collect:[]}:type==='monitor'?{exporters:[]}:{};
    return enter(s,modes[type],name);
  }
  if(s.mode==='flowRecord'){
    const record=own(d.flow?.records,s.current);
    if(!record)return invalid('The flow record does not exist.');
    if(verb==='description'){record.description=w.slice(1).join(' ');return reply();}
    const field=recordFields[w.slice(1).filter(word=>word!=='long').join(' ')];
    if(!field)return invalid('Use a supported flow field.');
    if(!record[verb].includes(field))record[verb].push(field);
    return reply();
  }
  if(s.mode==='flowExporter'){
    const exporter=own(d.flow?.exporters,s.current);
    if(!exporter)return invalid('The flow exporter does not exist.');
    if(verb==='description'){exporter.description=w.slice(1).join(' ');return reply();}
    if(verb==='destination'&&ipv4(type)!==null){exporter.destination=type;return reply();}
    if(verb==='source'){
      const port=interfaceName(w.slice(1));
      if(d.ports[port]){exporter.source=port;return reply();}
    }
    if(verb==='transport'&&integer(name,1,65535)){exporter.port=Number(name);return reply();}
    if(verb==='export-protocol'){exporter.protocol=type;return reply();}
    return invalid('Check the export destination, source interface or UDP port.');
  }
  if(s.mode==='flowMonitor'){
    const monitor=own(d.flow?.monitors,s.current);
    if(!monitor)return invalid('The flow monitor does not exist.');
    if(verb==='description'){monitor.description=w.slice(1).join(' ');return reply();}
    if(verb==='record'&&own(d.flow.records,type)){monitor.record=type;monitor.cache={};return reply();}
    if(verb==='exporter'&&(no||own(d.flow.exporters,type))){
      monitor.exporters=monitor.exporters.filter(key=>key!==type);
      if(!no)monitor.exporters.push(type);
      return reply();
    }
    if(verb==='cache'&&integer(w[3],1,604800)){monitor[name]=Number(w[3]);return reply();}
    return invalid('Check the monitor objects or cache timeout.');
  }
  return null;
}

export function observeFlows(lab,d,input,output,fields,packets=1) {
  const data=d.flow;
  if(!data)return;
  const now=Date.now();
  const names=[d.ports[input]?.monitors?.input,d.ports[output]?.monitors?.output].filter(Boolean);
  const packet={...fields,input,output};
  for(const name of new Set(names)){
    const monitor=own(data.monitors,name),record=own(data.records,monitor?.record);
    if(!record?.match.length)continue;
    const key=JSON.stringify(record.match.map(k=>packet[k]));
    const existing=fresh(monitor,now);
    monitor.cache=Object.fromEntries(existing.slice(-159));
    const previous=monitor.cache[key];
    const row={...packet,first:previous?.first??now,last:now,packets:(previous?.packets??0)+packets,
      bytes:(previous?.bytes??0)+packets*(packet.protocol==='icmp'?84:96)};
    monitor.cache[key]=row;
    for(const exporterName of monitor.exporters){
      const exporter=own(data.exporters,exporterName);
      if(!exporter?.destination||exporter.source&&!linkUp(lab,d,exporter.source))continue;
      const udp=exporter.port??2055;
      const hit=transaction(lab,d,exporter.destination,{sourceAddress:exporter.source?d.ports[exporter.source]?.address:undefined,
        packet:{protocol:'udp',sourcePort:49152,destinationPort:udp}});
      const server=hit.destination;
      if(!hit.ok||!server.services?.netflow||(server.netflowPort??2055)!==udp)continue;
      server.flows=[...(server.flows??[]).slice(-159),{...packet,packets,exporter:d.name,format:exporter.protocol??'netflow-v9'}];
      exporter.exported=(exporter.exported??0)+1;
    }
  }
}

export function flowRunning(d) {
  const flow=d.flow;
  if(!flow)return [];
  const syntax=Object.fromEntries(Object.entries(recordFields).map(([k,v])=>[v,k]));
  return [
    ...Object.entries(flow.records).flatMap(([name,row])=>['flow record '+name,
      ...row.match.map(field=>' match '+syntax[field]),...row.collect.map(field=>' collect '+syntax[field])]),
    ...Object.entries(flow.exporters).flatMap(([name,row])=>['flow exporter '+name,
      ...(row.destination?[' destination '+row.destination]:[]),...(row.source?[' source '+row.source]:[]),
      ...(row.port?[' transport udp '+row.port]:[]),...(row.protocol?[' export-protocol '+row.protocol]:[])]),
    ...Object.entries(flow.monitors).flatMap(([name,row])=>['flow monitor '+name,
      ...(row.record?[' record '+row.record]:[]),...row.exporters.map(e=>' exporter '+e),
      ...(row.active?[' cache timeout active '+row.active]:[]),...(row.inactive?[' cache timeout inactive '+row.inactive]:[])])
  ];
}
