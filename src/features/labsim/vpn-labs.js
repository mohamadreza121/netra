import { addDevice, addLink, emptyLab, endpoint } from './network.js';
import { configurePreset } from './enterprise-lab.js';

function scenario(name) {
  const lab={...emptyLab(),scenario:name};
  return {
    lab,
    add:(type,x,y)=>Object.assign(addDevice(lab,type),{x,y}),
    connect:(a,port,b,to)=>addLink(lab,endpoint(a,port),endpoint(b,to)),
    configure:(device,commands)=>configurePreset(lab,device,commands)
  };
}

export function providerVpnLab() {
  const {lab,add,connect,configure}=scenario('provider-vpn');
  const west=add('router',23,41),core=add('router',50,24),east=add('router',77,41);
  const first=add('pc',17,76),last=add('pc',83,76);
  connect(west,'Gi0/0',core,'Gi0/0');
  connect(east,'Gi0/0',core,'Gi0/1');
  connect(west,'Gi0/1',first,'Eth0');
  connect(east,'Gi0/1',last,'Eth0');
  configure(core,[
    'en','conf t','int gi0/0','ip address 192.0.2.2 255.255.255.252','ip ospf 72 area 0','mpls ip','no shutdown','exit',
    'int gi0/1','ip address 198.51.100.1 255.255.255.252','ip ospf 72 area 0','mpls ip','no shutdown','end'
  ]);
  for(const [device,local,remote,underlay,vrf,lan,rd] of [
    [west,'10.80.0.1','10.80.0.3','192.0.2.1','LAB-WEST','203.0.113.1','65080:1'],
    [east,'10.80.0.3','10.80.0.1','198.51.100.2','LAB-EAST','198.18.0.1','65080:2']
  ])configure(device,[
    'en','conf t','vrf definition '+vrf,'rd '+rd,'address-family ipv4','route-target both 65080:80','exit','exit',
    'int gi0/0','ip address '+underlay+' 255.255.255.252','ip ospf 72 area 0','mpls ip','no shutdown','exit',
    'int loopback0','ip address '+local+' 255.255.255.255','ip ospf 72 area 0','exit','mpls ldp router-id lo0 force',
    'int gi0/1','vrf forwarding '+vrf,'ip address '+lan+' 255.255.255.0','no shutdown','exit',
    'router bgp 65080','no bgp default ipv4-unicast','neighbor '+remote+' remote-as 65080','neighbor '+remote+' update-source lo0',
    'address-family vpnv4','neighbor '+remote+' activate','neighbor '+remote+' send-community extended','exit-address-family',
    'address-family ipv4 vrf '+vrf,'redistribute connected','end'
  ]);
  configure(first,['ip address 203.0.113.2 24 203.0.113.1']);
  configure(last,['ip address 198.18.0.2 24 198.18.0.1']);
  return lab;
}

export function dmvpnLab() {
  const {lab,add,connect,configure}=scenario('dmvpn');
  const hub=add('router',49,17),west=add('router',20,56),east=add('router',80,56),wan=add('switch',50,44);
  const first=add('pc',20,82),last=add('pc',80,82);
  connect(hub,'Gi0/0',wan,'Gi0/1');
  connect(west,'Gi0/0',wan,'Gi0/2');
  connect(east,'Gi0/0',wan,'Gi0/3');
  connect(west,'Gi0/1',first,'Eth0');
  connect(east,'Gi0/1',last,'Eth0');

  for(const [router,index] of [[hub,1],[west,2],[east,3]]){
    const primary=index===1;
    configure(router,[
      'en','conf t','int gi0/0','ip address 192.0.2.'+index+' 255.255.255.0','no shutdown','exit',
      'crypto ikev2 proposal LAB-IKE','encryption aes-cbc-256','integrity sha256','group 19','exit',
      'crypto ikev2 policy LAB-POLICY','proposal LAB-IKE','exit',
      'crypto ikev2 keyring LAB-RING','peer CLOUD','address 192.0.2.0 255.255.255.0','pre-shared-key NetraCloudLab',
      'exit','exit','crypto ikev2 profile LAB-IDENTITY','match identity remote address 192.0.2.0 255.255.255.0',
      'authentication local pre-share','authentication remote pre-share','keyring local LAB-RING','exit',
      'crypto ipsec transform-set LAB-ESP esp-aes 256 esp-sha256-hmac','mode transport','exit',
      'crypto ipsec profile DMVPN-PROTECT','set transform-set LAB-ESP','set ikev2-profile LAB-IDENTITY','exit',
      'int tunnel79','ip address 10.79.0.'+index+' 255.255.255.0','tunnel source gi0/0','tunnel mode gre multipoint',
      'tunnel key 79','ip nhrp network-id 79','ip nhrp authentication NetraCloud','tunnel protection ipsec profile DMVPN-PROTECT',
      ...(primary?['ip nhrp map multicast dynamic','ip nhrp redirect','no ip split-horizon eigrp 79']:
        ['ip nhrp map 10.79.0.1 192.0.2.1','ip nhrp map multicast 192.0.2.1','ip nhrp nhs 10.79.0.1','ip nhrp shortcut']),
      'exit',...(primary?[]:['int gi0/1','ip address 10.79.'+index+'.1 255.255.255.0','no shutdown','exit']),
      'router eigrp 79','network 10.79.0.0 0.0.0.255',
      ...(primary?[]:['network 10.79.'+index+'.0 0.0.0.255','passive-interface gi0/1']),'end'
    ]);
  }
  configure(first,['ip address 10.79.2.2 24 10.79.2.1']);
  configure(last,['ip address 10.79.3.2 24 10.79.3.1']);
  return lab;
}
