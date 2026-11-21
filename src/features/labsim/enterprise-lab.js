import { addDevice, addLink, emptyLab, endpoint, macAddress } from './network.js';
import { execute, terminalSession } from './cli.js';

export function configurePreset(lab,device,commands) {
  const session=terminalSession(device);
  for(const command of commands) {
    const result=execute(lab,device,session,command);
    if(result.text.startsWith('%'))throw new Error(device.name+' preset command failed: '+command+' · '+result.text);
  }
}

export function enterpriseLab() {
  const lab={...emptyLab(),scenario:'enterprise'};
  const add=(type,x,y)=>Object.assign(addDevice(lab,type),{x,y});
  const edge=add('router',42,16);
  const provider=add('router',73,16);
  const access=add('switch',42,43);
  const controller=add('wlc',72,43);
  const ap=add('ap',15,44);
  const ise=add('ise',72,70);
  const server=add('server',90,68);
  add('pc',15,79);
  const desk=add('pc',32,71);
  const phone=add('phone',48,81);
  const other=add('phone',59,81);
  const connect=(a,port,b,to)=>addLink(lab,endpoint(a,port),endpoint(b,to));
  connect(edge,'Gi0/1',provider,'Gi0/0');
  connect(edge,'Gi0/0',access,'Gi0/1');
  connect(access,'Gi0/2',controller,'Gi0/0');
  connect(access,'Gi0/3',ap,'Eth0');
  connect(access,'Gi0/4',ise,'Eth0');
  connect(access,'Gi0/5',server,'Eth0');
  connect(access,'Gi0/6',desk,'Eth0');
  connect(access,'Gi0/7',phone,'Eth0');
  connect(access,'Gi0/8',other,'Eth0');

  configurePreset(lab,edge,[
    'en','conf t','int gi0/0','no shut','exit',
    'int gi0/0.100','encapsulation dot1q 100 native','ip address 10.72.100.1 255.255.255.0','exit',
    'int gi0/0.110','encapsulation dot1q 110','ip address 10.72.110.1 255.255.255.0','ip helper-address 10.72.100.30','exit',
    'int gi0/0.120','encapsulation dot1q 120','ip address 10.72.120.1 255.255.255.0','ip helper-address 10.72.100.30','exit',
    'int gi0/1','ip address 192.0.2.1 255.255.255.252','no shut','exit',
    'router bgp 65001','neighbor 192.0.2.2 remote-as 65002','network 10.72.110.0 mask 255.255.255.0','network 10.72.120.0 mask 255.255.255.0','exit',
    'ip name-server 10.72.100.30','ntp server 10.72.100.30','logging host 10.72.100.30',
    'aaa new-model','tacacs server ISE','address ipv4 10.72.100.20','key NetraAdminLab','exit',
    'aaa group server tacacs+ ADMIN','server name ISE','exit','aaa authentication login default group ADMIN local',
    'ip domain name netra.test','crypto key generate rsa modulus 2048','ip ssh version 2','line vty 0 4','transport input ssh','login authentication default','end'
  ]);
  configurePreset(lab,provider,[
    'en','conf t','int gi0/0','ip address 192.0.2.2 255.255.255.252','no shut','exit',
    'int loopback0','ip address 203.0.113.53 255.255.255.255','exit',
    'router bgp 65002','neighbor 192.0.2.1 remote-as 65001','network 203.0.113.53 mask 255.255.255.255','end'
  ]);
  configurePreset(lab,access,[
    'en','conf t','vlan 100','name MGMT','exit','vlan 110','name STAFF','exit','vlan 120','name VOICE','exit',
    'int range gi0/1 - 2','switchport mode trunk','switchport trunk native vlan 100','switchport trunk allowed vlan 100,110,120','exit',
    'int range gi0/3 - 5','switchport mode access','switchport access vlan 100','exit',
    'int gi0/6','switchport mode access','switchport access vlan 110','authentication port-control auto','dot1x pae authenticator','exit',
    'int range gi0/7 - 8','switchport mode access','switchport access vlan 110','switchport voice vlan 120','exit',
    'int vlan 100','ip address 10.72.100.2 255.255.255.0','no shut','exit','ip default-gateway 10.72.100.1',
    'aaa new-model','radius server ISE','address ipv4 10.72.100.20 auth-port 1812 acct-port 1813','key NetraRadiusLab','exit',
    'aaa group server radius CAMPUS','server name ISE','exit','aaa authentication dot1x default group CAMPUS','dot1x system-auth-control','end'
  ]);
  configurePreset(lab,controller,[
    'en','conf t','int gi0/0','switchport mode trunk','switchport trunk native vlan 100','no shut','exit',
    'int vlan 100','ip address 10.72.100.10 255.255.255.0','no shut','exit',
    'wireless management interface vlan 100','ip default-gateway 10.72.100.1',
    'aaa new-model','radius server ISE','address ipv4 10.72.100.20 auth-port 1812 acct-port 1813','key NetraRadiusLab','exit',
    'aaa group server radius CAMPUS','server name ISE','exit','aaa authentication dot1x default group CAMPUS',
    'wlan Staff 10 Netra-Enterprise','security wpa akm dot1x','security dot1x authentication-list default','no shut','exit',
    'wireless profile policy STAFF','vlan 110','central switching','aaa-override','no shut','exit',
    'wireless tag policy CAMPUS','wlan Staff policy STAFF','exit','ap '+macAddress(ap),'policy-tag CAMPUS','end'
  ]);
  configurePreset(lab,ap,[
    'ip address 10.72.100.11 255.255.255.0 10.72.100.1','radio band 5','radio channel 36','radio on',
    'capwap ap primary-base WLC1 10.72.100.10'
  ]);
  configurePreset(lab,ise,[
    'ip address 10.72.100.20 24 10.72.100.1','application start ise','service radius on','service tacacs on',
    'network-device 10.72.100.2 secret NetraRadiusLab','network-device 10.72.100.10 secret NetraRadiusLab','network-device 10.72.100.1 secret NetraAdminLab',
    'identity user student password NetraStudent','authorization student vlan 110',
    'identity user netadmin password NetraAdmin','identity user denied password NetraStudent','authorization denied deny'
  ]);
  configurePreset(lab,server,[
    'ip address 10.72.100.30 24 10.72.100.1',
    'service dhcp on','service dns on','service http on','service ntp on','service syslog on','service tftp on','service sip on','service netflow on',
    'dhcp scope STAFF 10.72.110.0/24 10.72.110.1 10.72.100.30','dhcp exclude 10.72.110.1 10.72.110.20',
    'dhcp scope VOICE 10.72.120.0/24 10.72.120.1 10.72.100.30','dhcp exclude 10.72.120.1 10.72.120.20',
    'dhcp option 150 VOICE 10.72.100.30',
    'dns record campus.netra.test a 10.72.100.30','dns record provider.netra.test a 203.0.113.53',
    'http page /status Netra campus services are online.','ntp stratum 3',
    'sip user 2001 NetraVoice','sip user 2002 NetraVoice'
  ]);
  configurePreset(lab,phone,['ipconfig /renew','sip register 10.72.100.30 2001 NetraVoice']);
  configurePreset(lab,other,['ipconfig /renew','sip register 10.72.100.30 2002 NetraVoice']);
  return lab;
}
