import { dotted, inSubnet, ipv4, macAddress } from './network.js';
import { reply } from './cli-utils.js';

function leases(lab,server) {
  return lab.devices.filter(client=>client.host.lease?.server===server.id)
    .sort((a,b)=>ipv4(a.host.lease.ip)-ipv4(b.host.lease.ip));
}

function addressRange(pool,excluded) {
  const network=ipv4(pool.network);
  const low=network+1, high=network+2**(32-pool.prefix)-2;
  const ranges=excluded.map(([first,last])=>[Math.max(low,ipv4(first)),Math.min(high,ipv4(last))])
    .filter(([first,last])=>first<=last).sort(([a],[b])=>a-b);
  let upto=low-1,size=0;
  for(const [first,last] of ranges){
    if(last>upto){size+=last-Math.max(first-1,upto);upto=last;}
  }
  return {first:dotted(low),last:dotted(high),size:high-low+1,excluded:size};
}

export function showDhcp(lab,d,args) {
  const clients=leases(lab,d),query=args[4];
  if(args[3]==='binding'){
    const selected=clients.filter(client=>!query||client.host.lease.ip===query);
    const rows=selected.map(client=>{
      const {ip,tftp,duration}=client.host.lease;
      const [days='1',hours='0',mins='0']=duration?.split(' ')??[];
      return ip.padEnd(17)+macAddress(client).padEnd(20)+[days,hours,mins].join(' ').padEnd(16)+'Automatic  Active'+
        '  '+client.name+(tftp?'  TFTP '+tftp:'');
    });
    return reply(rows.length?['Bindings from all lab pools:',
      'IP address       Hardware address    Lease (d h m)   Type       State   Client',...rows].join('\n'):'No DHCP bindings.');
  }
  const pools=Object.entries(d.pools).filter(([name])=>!query||name===query.toUpperCase());
  return reply(pools.length?pools.map(([name,p])=>{
    const settings=['Pool '+name+' :',
      ' Default router          : '+(p.gateway??'Not configured'),
      ' DNS server              : '+(p.dns??'Not configured'),
      ' Option 150 (TFTP)       : '+(p.tftp??'Not configured')];
    if(!p.network)return [...settings,' No subnet configured.'].join('\n');
    const count=clients.filter(client=>inSubnet(client.host.lease.ip,p.network,p.prefix)).length;
    const space=addressRange(p,d.excluded);
    return [...settings,' Total addresses         : '+space.size,' Leased addresses        : '+count,
      ' Excluded addresses      : '+space.excluded,' IP address range        : '+space.first+' - '+space.last].join('\n');
  }).join('\n\n'):'No DHCP pools.');
}
