import { ipv4 } from './network.js';

function operand(words) {
  const address = words.shift();
  if (address?.toLowerCase()==='any') return {any:true};
  if (address?.toLowerCase()==='host') {
    const host=words.shift();
    return ipv4(host)===null?null:{address:host,wildcard:'0.0.0.0'};
  }
  if (ipv4(address)===null) return null;
  const wildcard=ipv4(words[0])===null?'0.0.0.0':words.shift();
  return {address,wildcard};
}

const ports={ssh:22,telnet:23,www:80,http:80,https:443,domain:53,'bootps':67,'bootpc':68,tftp:69,ntp:123,
  snmp:161,snmptrap:162,bgp:179,syslog:514,radius:1812,'radius-acct':1813,'tacacs':49,'tacacs-ds':49,ftp:21};
function transportPort(value) {
  if(/^\d{1,5}$/.test(value??'')&&Number(value)<=65535)return Number(value);
  return Object.hasOwn(ports,value?.toLowerCase())?ports[value.toLowerCase()]:undefined;
}
function service(words) {
  const op=words[0]?.toLowerCase();
  if(!['eq','neq','gt','lt','range'].includes(op))return undefined;
  const [,first,last]=words.splice(0,op==='range'?3:2);
  const a=transportPort(first),b=transportPort(last);
  return a===undefined||op==='range'&&(b===undefined||a>b)?null:{op,a,b};
}

export function parseRule(type, args, sequence) {
  const words = [...args];
  const action=words.shift()?.toLowerCase();
  if (action==='remark' && words.length) return {sequence, action, raw:args.join(' ')};
  if (!['permit','deny'].includes(action)) return null;
  const protocol=type==='standard'?'ip':words.shift()?.toLowerCase();
  if (!['ip','icmp','tcp','udp','ospf','eigrp','gre'].includes(protocol)) return null;
  const source=operand(words);
  const transport=['tcp','udp'].includes(protocol);
  const sourcePort=transport?service(words):undefined;
  const destination=type==='standard'?{any:true}:operand(words);
  const destinationPort=transport?service(words):undefined;
  const icmp=protocol==='icmp'&&['echo','echo-reply'].includes(words[0]?.toLowerCase())?words.shift().toLowerCase():undefined;
  const established=protocol==='tcp'&&words[0]?.toLowerCase()==='established';
  if(established)words.shift();
  if (['log','log-input'].includes(words[0]?.toLowerCase())) words.shift();
  if (!source || !destination || sourcePort===null || destinationPort===null || words.length) return null;
  return {sequence, action, protocol, source, destination, sourcePort,destinationPort,established,icmp,hits:0,raw:args.join(' ')};
}

function matches(operand,address) {
  const fixed=~ipv4(operand.wildcard);
  return operand.any || ipv4(address)!==null && (ipv4(address)&fixed)===(ipv4(operand.address)&fixed);
}

function matchesPort(condition,value) {
  if(!condition)return true;
  if(value===undefined)return false;
  const {op,a,b}=condition;
  switch(op){
    case 'eq':return value===a;
    case 'neq':return value!==a;
    case 'gt':return value>a;
    case 'lt':return value<a;
    case 'range':return value>=a&&value<=b;
  }
}

export function allowsTraffic(device,listName,source,destination,packet,count=true,missing=false) {
  const list=listName&&Object.hasOwn(device.acl??{},listName)&&device.acl[listName];
  if(!list)return missing;
  const rule=list.rules.find(row=>(row.protocol==='ip'||row.protocol===packet.protocol)
    &&(!row.icmp||row.icmp===packet.icmp)&&(!row.established||packet.established)
    &&matches(row.source,source)&&matches(row.destination,destination)
    &&matchesPort(row.sourcePort,packet.sourcePort)&&matchesPort(row.destinationPort,packet.destinationPort));
  if(!rule)return false;
  if(count)rule.hits++;
  return rule.action==='permit';
}

export function aclPermits(device,listName,source,destination,icmp,count=true,missing=false) {
  return allowsTraffic(device,listName,source,destination,{protocol:'icmp',icmp},count,missing);
}

export function permitsPacket(device,port,direction,source,destination,packet,count=true) {
  return allowsTraffic(device,device.ports[port]?.acl?.[direction],source,destination,packet,count,true);
}
