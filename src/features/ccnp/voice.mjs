import { config, configure, exec, lesson, shell } from './lesson.mjs';
import { voiceCmeLab, voiceGateway } from '../labsim/voice-lab.js';

const sw='SW1',r='R1',left='TEL1',right='TEL2',pc='PC1';
const topology=['R1 · DHCP and SCCP CME','SW1 · data VLAN 10 and voice VLAN 20',
  'TEL1 Eth0 ↔ SW1 Gi0/2 · TEL1 Eth1 ↔ PC1','TEL2 Eth0 ↔ SW1 Gi0/3'];
const supplement=key=>({encor:[key],enarsi:[key]});

export const voicePractice=[
  lesson({
    id:'voice-cme-sccp',title:'IP phones and CME · SCCP auto-registration',
    topics:supplement('extra.voice-cme'),portable:[],guide:[],topology,
    buildWorkspace:voiceCmeLab,
    task:'Build a local SCCP call manager, give the phones DHCP option 150, and watch a call go from ringing to connected. The data PC shares the first phone’s switch port.'
  },[
    configure(sw,['interface GigabitEthernet0/2'],[
      ['switchport mode access','Set the phone-facing port to static access mode.'],
      ['switchport access vlan 10','Put the untagged traffic from PC1 in the data VLAN.'],
      ['switchport voice vlan 20','Advertise a separate tagged voice VLAN to the phone.']
    ]),
    exec(sw,[
      ['show interfaces GigabitEthernet0/2 switchport','Read the access and voice VLANs on the same interface.'],
      ['show interfaces trunk','Confirm that the switch-to-router trunk carries VLANs 10 and 20.']
    ]),
    shell(pc,[['ipconfig /renew','Request an address through TEL1’s PC passthrough. PC1 should receive a 10.20.10.x lease.']]),
    shell(left,[
      ['ipconfig /renew','The phone gets an address in VLAN 20. Registration fails because DHCP has yet to supply a TFTP address.'],
      ['show phone network','Compare the phone’s operational VLAN and DHCP settings to PC1’s.']
    ]),
    configure(r,['ip dhcp pool VOICE'],[
      ['option 150 ip '+voiceGateway,'Give voice clients the address of the CME router’s TFTP service.']
    ]),
    configure(r,['telephony-service'],[
      ['max-ephones 5','Allow up to five provisioned ephone records on this router.'],
      ['max-dn 10','Allow directory number tags up to 10. Tags are distinct from extensions.'],
      ['ip source-address '+voiceGateway+' port 2000','Bind CME signaling to the voice subinterface using the SCCP TCP port.'],
      ['keepalive 30','Set the global SCCP keepalive interval to 30 seconds.'],
      ['auto-reg-ephone','Allow a phone with a previously unconfigured MAC to register.']
    ]),
    configure(r,['ephone-dn 1 dual-line'],[
      ['number 2001','Assign extension 2001 to directory number tag 1.'],
      ['name Reception','Add the subscriber name.'],
      ['label Reception','Give the first line button a readable label.']
    ]),
    configure(r,['ephone-dn 2 dual-line'],[
      ['number 2002','Assign extension 2002 to directory number tag 2.'],
      ['label Support','Give the second phone a readable line label.']
    ]),
    configure(r,['telephony-service'],[
      ['auto assign 1 to 2','Assign available DN tags 1 and 2 in the order the phones register.'],
      ['create cnf-files','Make the SCCP boot profile available to the phones through TFTP.']
    ]),
    exec(r,[
      ['show telephony-service all','Verify the source, capacity, DN ranges and configuration file state.'],
      ['show telephony-service tftp-bindings','Confirm the default SCCP profile is published.']
    ]),
    shell(left,[
      ['boot','Renew DHCP, fetch the TFTP profile, and register TEL1 with extension 2001.'],
      ['show sccp status','Check the assigned line and SCCP server.']
    ]),
    shell(right,[['boot','Register the second phone and assign extension 2002.']]),
    exec(r,[
      ['show ip dhcp binding','Check that the PC and phones received addresses from their respective subnets.'],
      ['show ip dhcp pool VOICE','Verify option 150, the gateway and the remaining address pool.'],
      ['show ephone registered summary','Match each extension and phone MAC to its DHCP address.']
    ]),
    shell(left,[
      ['dial 2999','An unknown extension should fail immediately and leave a reason in the call log.'],
      ['dial 2002','Place the call. TEL2 should ring while TEL1 hears simulated ringback.']
    ]),
    exec(r,[['show ephone ringing','Check which registered handset is ringing.']]),
    shell(right,[
      ['show phone','Confirm TEL2 reports an incoming call from 2001.'],
      ['answer','Accept the call and test the two-way simulated RTP path.']
    ]),
    exec(r,[['show call active voice brief','Confirm the call state is CONNECTED.']]),
    shell(left,[['hangup','End the connected call.']]),
    exec(r,[
      ['show call history voice brief','Compare the failed dial and the completed call.'],
      ['show telephony-service events','Trace registration, ringback, answer and disconnect events.'],
      ['copy running-config startup-config','Save the CME and DHCP configuration in the lab router.']
    ])
  ]),

  lesson({
    id:'voice-cme-manual',title:'IP phones and CME · manual registration and fault isolation',
    topics:supplement('extra.voice-troubleshoot'),portable:[],guide:[],topology,
    buildWorkspace:()=>voiceCmeLab({mode:'manual'}),
    task:'Investigate a rejected phone, map each MAC to a line by hand, and troubleshoot a voice VLAN fault. CME and option 150 are preconfigured with automatic registration disabled.'
  },[
    shell(left,[['boot','The phone reaches CME, but an unknown MAC must be rejected.']]),
    exec(r,[
      ['show ephone attempted-registrations','Read the rejected MAC and the registration policy failure.'],
      ['show ephone-dn','Confirm DNs 1 and 2 exist before assigning buttons.']
    ]),
    configure(r,['ephone 1'],[
      ['mac-address 0200.0000.0003','Permit TEL1 by its MAC from the registration attempt.'],
      ['type 7960','Set the SCCP lab handset model.'],
      ['button 1:1','Bind the first physical button to DN tag 1.'],
      ['keepalive 45','Override the global interval for TEL1 only.']
    ]),
    configure(r,['ephone 2'],[
      ['mac-address 0200.0000.0004','Permit TEL2 by its separate MAC.'],
      ['type 7960','Set the SCCP phone model.'],
      ['button 1:2','Bind the first button to DN tag 2, extension 2002.']
    ]),
    configure(r,['telephony-service'],[
      ['create cnf-files','Publish the default profile and the per-phone files.']
    ]),
    shell(left,[['sccp register','Retry registration using TEL1’s existing address and option 150.']]),
    shell(right,[['boot','Bring TEL2 online and verify its assigned extension.']]),
    exec(r,[
      ['show ephone 1','Verify TEL1’s MAC, DN and per-phone keepalive.'],
      ['show ephone registered','Confirm both phones are registered.']
    ]),
    configure(sw,['interface GigabitEthernet0/3'],[
      ['no switchport voice vlan','Remove the tagging instruction from TEL2’s port to simulate a faulty access configuration.']
    ]),
    shell(right,[['boot','TEL2 lands in the data VLAN. The data DHCP pool has no voice option 150.']]),
    shell(left,[['dial 2002','Watch the call fail because extension 2002 has no registered phone.']]),
    exec(sw,[
      ['show interfaces GigabitEthernet0/3 switchport','Confirm the voice VLAN is missing even though the link is up.'],
      ['show vlan brief','Check that VLAN 20 exists in the VLAN database.']
    ]),
    configure(sw,['interface GigabitEthernet0/3'],[
      ['switchport voice vlan 20','Restore the voice VLAN on the link to TEL2.']
    ]),
    shell(right,[['boot','Renew in VLAN 20 and verify SCCP comes back.']]),
    shell(left,[['dial 2002','Confirm TEL2 rings after recovery.']]),
    shell(right,[['reject','Decline this test call and release both handsets.']]),
    exec(r,[['show telephony-service events','Compare the rejection during registration, the failed dial and the call that reached TEL2.']])
  ])
];
