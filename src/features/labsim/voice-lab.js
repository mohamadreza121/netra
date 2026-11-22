import { addDevice, addLink, emptyLab, endpoint } from './network.js';
import { configurePreset } from './enterprise-lab.js';

export const voiceGateway='10.20.20.1';

export function voiceCmeLab({mode='starter'}={}) {
  const lab={...emptyLab(),scenario:'voice-cme'};
  const add=(type,x,y)=>Object.assign(addDevice(lab,type),{x,y});
  const router=add('router',47,13),sw=add('switch',47,36);
  const left=add('phone',27,61),right=add('phone',67,61);
  const pc=add('pc',27,84);
  for(const [a,p,b,q] of [
    [router,'Gi0/0',sw,'Gi0/1'],[sw,'Gi0/2',left,'Eth0'],[sw,'Gi0/3',right,'Eth0'],[left,'Eth1',pc,'Eth0']
  ])addLink(lab,endpoint(a,p),endpoint(b,q));
  configurePreset(lab,sw,[
    'en','conf t','vlan 10','name DATA','exit','vlan 20','name VOICE','exit',
    'interface gi0/1','description R1 uplink','switchport mode trunk','switchport trunk allowed vlan 10,20','exit',
    'interface gi0/2','description TEL1 and PC1','switchport mode access','switchport access vlan 10','switchport voice vlan 20','exit',
    'interface gi0/3','description TEL2','switchport mode access','switchport access vlan 10','switchport voice vlan 20','end'
  ]);
  configurePreset(lab,router,[
    'en','conf t','interface gi0/0','no shutdown','exit',
    'interface gi0/0.10','encapsulation dot1q 10','ip address 10.20.10.1 255.255.255.0','exit',
    'interface gi0/0.20','encapsulation dot1q 20','ip address '+voiceGateway+' 255.255.255.0','exit',
    'ip dhcp excluded-address 10.20.10.1 10.20.10.20','ip dhcp excluded-address 10.20.20.1 10.20.20.20',
    'ip dhcp pool DATA','network 10.20.10.0 255.255.255.0','default-router 10.20.10.1','exit',
    'ip dhcp pool VOICE','network 10.20.20.0 255.255.255.0','default-router '+voiceGateway,
    ...(mode==='starter'?[]:['option 150 ip '+voiceGateway]),'end'
  ]);
  if(mode!=='starter')configurePreset(lab,router,[
    'en','conf t','telephony-service','max-ephones 5','max-dn 10','ip source-address '+voiceGateway+' port 2000',
    ...(mode==='manual'?['no auto-reg-ephone']:['auto-reg-ephone','auto assign 1 to 2']),
    'create cnf-files','exit','ephone-dn 1 dual-line','number 2001','label Reception','exit',
    'ephone-dn 2 dual-line','number 2002','label Support','end'
  ]);
  if(mode==='ready')for(const device of [left,right,pc])configurePreset(lab,device,['ipconfig /renew']);
  return lab;
}
