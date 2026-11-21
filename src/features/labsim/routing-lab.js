import { addDevice, addLink, emptyLab, endpoint } from './network.js';
import { configurePreset } from './enterprise-lab.js';

export function routingLab() {
  const lab={...emptyLab(),scenario:'routing'};
  const add=(type,x,y)=>Object.assign(addDevice(lab,type),{x,y});
  const core=add('router',17,27), transit=add('router',42,16), branch=add('router',66,27), edge=add('router',87,65);
  const pc=add('pc',17,68), branchPc=add('pc',65,68);
  const wire=(a,port,b,to)=>addLink(lab,endpoint(a,port),endpoint(b,to));
  wire(core,'Gi0/0',transit,'Gi0/0');wire(transit,'Gi0/1',branch,'Gi0/0');
  wire(core,'Gi0/1',pc,'Eth0');wire(branch,'Gi0/1',branchPc,'Eth0');wire(branch,'Gi0/2',edge,'Gi0/0');
  configurePreset(lab,core,[
    'en','conf t','int gi0/0','ip address 192.0.2.1 255.255.255.252','no shut','exit',
    'ip route 198.51.100.0 255.255.255.252 192.0.2.2',
    'int tunnel72','ip address 10.72.0.1 255.255.255.252','tunnel source gi0/0','tunnel destination 198.51.100.2',
    'tunnel key 72','ip ospf 72 area 0','exit',
    'int gi0/1','ip address 10.72.10.1 255.255.255.0','ip ospf 72 area 10','no shut','exit',
    'router ospf 72','router-id 10.72.0.1','passive-interface gi0/1','end'
  ]);
  configurePreset(lab,transit,[
    'en','conf t','int gi0/0','ip address 192.0.2.2 255.255.255.252','no shut','exit',
    'int gi0/1','ip address 198.51.100.1 255.255.255.252','no shut','end'
  ]);
  configurePreset(lab,branch,[
    'en','conf t','int gi0/0','ip address 198.51.100.2 255.255.255.252','no shut','exit',
    'ip route 192.0.2.0 255.255.255.252 198.51.100.1',
    'int tunnel72','ip address 10.72.0.2 255.255.255.252','tunnel source gi0/0','tunnel destination 192.0.2.1',
    'tunnel key 72','ip ospf 72 area 0','exit',
    'int gi0/1','ip address 10.72.20.1 255.255.255.0','ip ospf 72 area 20','no shut','exit',
    'int gi0/2','ip address 10.72.0.5 255.255.255.252','no shut','exit',
    'ip prefix-list BRANCH-EIGRP seq 5 permit 10.72.90.4/32','route-map IMPORT-EDGE permit 10',
    'match ip address prefix-list BRANCH-EIGRP','set tag 90','exit',
    'router ospf 72','router-id 10.72.0.2','passive-interface gi0/1','redistribute eigrp 90 subnets route-map IMPORT-EDGE','exit',
    'router eigrp BRANCH','address-family ipv4 unicast autonomous-system 90','network 10.72.0.4 0.0.0.3',
    'topology base','redistribute ospf 72 metric 100000 10 255 1 1500','end'
  ]);
  configurePreset(lab,edge,[
    'en','conf t','int gi0/0','ip address 10.72.0.6 255.255.255.252','no shut','exit',
    'int lo0','ip address 10.72.90.4 255.255.255.255','exit',
    'router eigrp 90','network 10.72.0.4 0.0.0.3','network 10.72.90.4 0.0.0.0','end'
  ]);
  configurePreset(lab,pc,['ip address 10.72.10.21 24 10.72.10.1']);
  configurePreset(lab,branchPc,['ip address 10.72.20.21 24 10.72.20.1']);
  return lab;
}
