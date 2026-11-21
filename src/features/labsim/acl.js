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

export function parseRule(type, args, sequence) {
  const words = [...args];
  const action=words.shift()?.toLowerCase();
  if (action==='remark' && words.length) return {sequence, action, raw:args.join(' ')};
  if (!['permit','deny'].includes(action)) return null;
  const protocol=type==='standard'?'ip':words.shift()?.toLowerCase();
  if (!['ip','icmp','tcp','udp'].includes(protocol)) return null;
  const source=operand(words);
  const portOperator = () => {
    const op=words[0]?.toLowerCase();
    if (!['eq','neq','gt','lt','range'].includes(op)) return;
    const values=words.splice(0,op==='range'?3:2);
    if (!values[1] || (op==='range'&&!values[2])) words.unshift('invalid');
  };
  if (['tcp','udp'].includes(protocol)) portOperator();
  const destination=type==='standard'?{any:true}:operand(words);
  if (['tcp','udp'].includes(protocol)) portOperator();
  const icmp=protocol==='icmp'&&['echo','echo-reply'].includes(words[0]?.toLowerCase())?words.shift().toLowerCase():undefined;
  if (['log','log-input'].includes(words[0]?.toLowerCase())) words.shift();
  if (!source || !destination || words.length) return null;
  return {sequence, action, protocol, source, destination, icmp, hits:0, raw:args.join(' ')};
}

function matches(operand,address) {
  const fixed=~ipv4(operand.wildcard);
  return operand.any || (ipv4(address)&fixed)===(ipv4(operand.address)&fixed);
}

export function aclPermits(device, listName, source, destination, icmp, count=true, missing=false) {
  const list=listName&&Object.hasOwn(device.acl??{},listName)&&device.acl[listName];
  if (!list) return missing;
  const rule=list.rules.find(row=>['ip','icmp'].includes(row.protocol)&&(!row.icmp||row.icmp===icmp)&&matches(row.source,source)&&matches(row.destination,destination));
  if (!rule) return false;
  if (count) rule.hits++;
  return rule.action==='permit';
}

export function permitsPing(device, port, direction, source, destination, icmp) {
  return aclPermits(device,device.ports[port]?.acl?.[direction],source,destination,icmp,true,true);
}
