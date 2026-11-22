import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, prompt, terminalSession } from '../src/features/labsim/cli.js';
import { addDevice, addLink, endpoint, macAddress, restoreLab } from '../src/features/labsim/network.js';
import { voiceCmeLab, voiceGateway } from '../src/features/labsim/voice-lab.js';

function console(lab,d) {
  const session=terminalSession(d);
  const run=command=>execute(lab,d,session,command).text;
  return {
    run,
    config(...commands){
      if(session.mode==='user')assert.doesNotMatch(run('en'),/^%/);
      assert.doesNotMatch(run('conf t'),/^%/);
      for(const command of [...commands,'end'])assert.doesNotMatch(run(command),/^%/,d.name+' '+command);
    },
    prompt:()=>prompt(d,session,lab)
  };
}

test('CME separates DHCP, downloaded profile, directory number and assigned button',()=>{
  const lab=voiceCmeLab(),[r,s,a,b,pc]=lab.devices;
  const [router,sw,tel1,tel2,client]=[r,s,a,b,pc].map(d=>console(lab,d));
  assert.match(client.run('ipconfig /renew'),/10\.20\.10\.21/);
  assert.match(tel1.run('ipconfig /renew'),/10\.20\.20\.21[\s\S]*No TFTP server/);
  assert.match(tel1.run('show phone network'),/Operational VLAN ID: 20/);
  assert.match(tel1.run('show phone log'),/No TFTP server/);
  assert.match(sw.run('show interfaces Gi0/2 switchport'),/Access Mode VLAN: 10 \(DATA\)[\s\S]*Voice VLAN: 20 \(VOICE\)/);
  assert.match(sw.run('show interfaces trunk'),/Vlans in spanning tree forwarding state and not pruned\nGi0\/1\s+10,20/);
  assert.match(sw.run('show interfaces Gi0/2 status'),/TEL1 and PC1\s+connected\s+10\s+a-full\s+a-100/);
  assert.match(router.run('sh ip int br'),/Gi0\/0\.20\s+10\.20\.20\.1\s+YES manual\s+up\s+up/);

  router.config('ip dhcp pool VOICE','option 150 ip '+voiceGateway,'exit',
    'telephony-service','max-ephone 1','max-dn 10','ip source-address '+voiceGateway+' port 2000','keepalive 40',
    'auto assign 1 to 2','exit','ephone-dn 1 dual-line','number 2001','exit','ephone-dn 2','number 2002');
  assert.match(tel1.run('boot'),/No CME configuration files/);
  assert.match(router.run('show ip dhcp pool VOICE'),/Option 150 \(TFTP\)\s+: 10\.20\.20\.1[\s\S]*Leased addresses\s+: 1/);

  router.config('telephony-service','create cnf-files');
  assert.match(client.run('tftp get '+voiceGateway+' XMLDefault.cnf.xml'),/<ethernetPhonePort>2000<\/ethernetPhonePort>/);
  assert.match(tel1.run('boot'),/registered as ephone 1 with extension 2001/);
  assert.match(tel2.run('boot'),/No free ephone slot/);
  router.config('telephony-service','max-ephones 2');
  assert.match(tel2.run('sccp register'),/registered as ephone 2 with extension 2002/);
  assert.match(router.run('sh ephone reg sum'),/2001\s+REGISTERED[\s\S]*2002\s+REGISTERED/);
  assert.match(router.run('show ephone 1'),/keepalive 40 sec/);
  assert.match(router.run('show ip dhcp binding'),/Hardware address[\s\S]*10\.20\.20\.22\s+0200\.0000\.0004/);
  assert.match(router.run('show running-config'),/telephony-service\n max-ephones 2[\s\S]* option 150 ip 10\.20\.20\.1/);
});

test('call states follow ringing, answer, rejection and loss of signaling',()=>{
  const lab=voiceCmeLab({mode:'ready'}),[r,s,a,b]=lab.devices;
  const [router,sw,tel1,tel2]=[r,s,a,b].map(d=>console(lab,d));
  router.run('enable');
  assert.match(tel1.run('dial 2999'),/Call failed.*Unallocated extension/);
  assert.match(tel1.run('dial 2002'),/TEL2 is ringing/);
  assert.match(tel2.run('show phone'),/RINGING · Incoming from 2001/);
  assert.match(router.run('show ephone ringing'),/ephone-2.*REGISTERED/);
  assert.match(tel1.run('answer'),/No incoming call/);
  assert.match(tel2.run('reject'),/rejected/);
  assert.match(tel1.run('dial 2002'),/TEL2 is ringing/);
  assert.match(tel2.run('answer'),/connected:[\s\S]*Two-way RTP path verified/);
  assert.match(router.run('show call active voice brief'),/2001.*2002.*CONNECTED/);
  sw.config('interface gi0/3','shutdown');
  assert.match(router.run('show call active voice brief'),/No active voice calls/);
  assert.match(router.run('show call history voice brief'),/DISCONNECTED.*SCCP signaling was lost/);
  assert.match(tel2.run('show phone log'),/RINGING[\s\S]*REJECTED[\s\S]*ANSWERED[\s\S]*DISCONNECTED/);
  assert.match(router.run('show logging'),/%CME-6-LABVOICE: .*SCCP signaling was lost/);
  sw.config('interface gi0/3','no shutdown');
  assert.match(tel2.run('boot'),/with extension 2002/);
  assert.match(tel1.run('dial 2002'),/TEL2 is ringing/);
  assert.match(tel1.run('hangup'),/ended/);
});

test('SCCP TCP and TFTP UDP failures are reported independently',()=>{
  const lab=voiceCmeLab({mode:'ready'}),[r,,a]=lab.devices;
  const router=console(lab,r),phone=console(lab,a);
  router.config('telephony-service','ip source-address '+voiceGateway+' port 2120');
  assert.match(phone.run('boot'),/TFTP profile is stale/);
  assert.match(router.run('show telephony-service'),/Stale/);
  router.config('telephony-service','create cnf-files','exit',
    'ip access-list extended VOICE-IN','deny udp any host '+voiceGateway+' eq 69','permit ip any any','exit',
    'interface gi0/0.20','ip access-group VOICE-IN in');
  assert.match(phone.run('boot'),/TFTP 10\.20\.20\.1 is unreachable.*UDP/);
  router.config('ip access-list extended VOICE-IN','no 10','5 deny tcp any host '+voiceGateway+' eq 2120');
  assert.match(phone.run('boot'),/SCCP TCP\/2120 failed.*TCP/);
  router.config('interface gi0/0.20','no ip access-group VOICE-IN in');
  assert.match(phone.run('boot'),/SCCP TCP\/2120.*registered/);
  assert.match(router.run('show ip interface gi0/0.20'),/Inbound access list is not set/);
});

test('SCCP calls can ring across routed voice VLANs while an ACL blocks RTP',()=>{
  const lab=voiceCmeLab({mode:'ready'}),[r,s,a,b]=lab.devices;
  const [router,sw,tel1,tel2]=[r,s,a,b].map(d=>console(lab,d));
  router.config('interface gi0/0.30','encapsulation dot1q 30','ip address 10.20.30.1 255.255.255.0','exit',
    'ip dhcp pool VOICE-REMOTE','network 10.20.30.0 255.255.255.0','default-router 10.20.30.1','option 150 ip '+voiceGateway,'exit',
    'ip access-list extended BLOCK-RTP','deny udp any any range 16384 32767','permit ip any any','exit',
    'interface gi0/0.30','ip access-group BLOCK-RTP out');
  sw.config('vlan 30','name VOICE-REMOTE','exit','interface gi0/1','switchport trunk allowed vlan add 30','exit','interface gi0/3','switchport voice vlan 30');
  assert.match(tel2.run('boot'),/DHCP lease: 10\.20\.30\.[0-9]+[\s\S]*extension 2002/);
  assert.match(tel1.run('dial 2002'),/TEL2 is ringing/);
  assert.match(tel2.run('answer'),/RTP media is unreachable.*outbound access list/);
  assert.match(router.run('show call history voice brief'),/FAILED.*RTP media is unreachable/);
  router.config('interface gi0/0.30','no ip access-group BLOCK-RTP out');
  assert.match(tel1.run('dial 2002'),/TEL2 is ringing/);
  assert.match(tel2.run('answer'),/Two-way RTP path verified/);
  assert.match(router.run('show ephone rtp connections'),/CONNECTED/);
});

test('manual SCCP registration and configuration survive workspace import and router restart',()=>{
  let lab=voiceCmeLab({mode:'manual'});
  let [r,,a]=lab.devices,router=console(lab,r),phone=console(lab,a);
  router.run('en');
  assert.match(phone.run('boot'),/Automatic registration is disabled/);
  assert.match(router.run('show ephone attempted-registrations'),/0200\.0000\.0003.*disabled/);
  router.run('clear telephony-service ephone-attempted-registrations');
  assert.match(router.run('show ephone attempted-registrations'),/No rejected/);
  router.config('ephone 1','mac-address '+macAddress(a),'type 7960','button 1:1','keepalive 45','exit',
    'telephony-service','create cnf-files');
  assert.match(phone.run('sccp register'),/with extension 2001/);
  assert.match(router.run('show ephone registered'),/7960.*keepalive 45 sec/);
  assert.match(router.run('show telephony-service tftp-bindings'),/SEP020000000003.cnf.xml/);
  router.run('write memory');
  lab=restoreLab(JSON.stringify(lab));
  [r,,a]=lab.devices;
  router=console(lab,r);phone=console(lab,a);
  assert.match(phone.run('show sccp status'),/SCCP · REGISTERED/);
  assert.match(router.run('en'),/^$/);
  assert.match(router.run('reload'),/device restarted/);
  assert.match(phone.run('show sccp status'),/UNREGISTERED/);
  assert.match(phone.run('boot'),/with extension 2001/);
});

test('CME forwards a local extension to a different registered handset',()=>{
  const lab=voiceCmeLab({mode:'ready'}),[r,s,a,b]=lab.devices;
  const phone=addDevice(lab,'phone');
  addLink(lab,endpoint(s,'Gi0/4'),endpoint(phone,'Eth0'));
  const [router,sw,tel1,tel2,tel3]=[r,s,a,b,phone].map(d=>console(lab,d));
  sw.config('interface gi0/4','switchport access vlan 10','switchport voice vlan 20');
  router.config('ephone-dn 3','number 2003','exit','ephone 3','mac-address '+macAddress(phone),'button 1:3','exit',
    'ephone-dn 2','call-forward all 2003');
  tel3.run('boot');
  assert.match(tel1.run('dial 2002'),/TEL3 is ringing/);
  assert.match(tel2.run('answer'),/No active SCCP call/);
  assert.match(tel3.run('answer'),/connected/);
  assert.match(tel3.run('show phone log'),/2002 forwarded to 2003/);
});

test('phone tftp-server configures static TFTP and can return to DHCP option 150',()=>{
  const lab=voiceCmeLab({mode:'ready'}),[,,,tel2]=lab.devices;
  const phone=console(lab,tel2);
  phone.run('ip address 10.20.20.100 255.255.255.0 10.20.20.1');
  assert.match(phone.run('boot'),/No TFTP server/);
  assert.match(phone.run('tftp-server 999.20.20.1'),/^%/);
  assert.match(phone.run('tftp-server '+voiceGateway),/Static TFTP server set/);
  assert.match(phone.run('boot'),/TFTP profile downloaded[\s\S]*registered as ephone 2/);
  assert.match(phone.run('show phone network'),/10\.20\.20\.100[\s\S]*Static override/);
  assert.match(phone.run('no tftp-server'),/Static TFTP server cleared/);
  assert.match(phone.run('boot'),/No TFTP server/);
  assert.match(phone.run('ip address dhcp'),/registered as ephone 2/);
  assert.match(phone.run('show phone network'),/DHCP option 150/);
});
