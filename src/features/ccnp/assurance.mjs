import { lesson, configure, config, exec, shell, toggle, observe, read, all, assign } from './lesson.mjs';
const c=configure;

export const assurance = [
  lesson({
    id:'ntp-ptp-time',title:'NTP and PTP timing verification',topics:{encor:['3.3.a'],enarsi:['4.3']},portable:[11],guide:[24],
    topology:['R1 · NTP client','R2 · Reference clock fixture','SW1 · PTP boundary clock fixture'],
    task:'Fix an authenticated NTP association and read a PTP port state. Distinguish timestamp display, a synchronized reference clock and clock selection.'
  },[
    exec('R1',[observe('show ntp status','Determine whether the client has selected a reference clock.',all('ntpAuth','ntpServer'),
      'Clock is synchronized, stratum 3, reference is 192.0.2.189','Clock is unsynchronized, stratum 16, no reference clock')]),
    config('R1',[
      ['clock timezone EST -5 0','Set the local display offset, independent of the NTP protocol timescale.'],
      ['clock summer-time EDT recurring','Apply the lab’s recurring daylight saving display.'],
      ['service timestamps log datetime msec localtime show-timezone','Make elapsed times and zone explicit in log output.'],
      ['service timestamps debug datetime msec','Timestamp debug messages for correlation.'],
      ['ntp source Loopback0','Source NTP from a known routed interface.'],
      ['ntp authenticate','Require authentication for the configured association.'],
      ['ntp authentication-key 72 md5 NetraTimeLab','Add the lab authentication key for this compatibility example.'],
      toggle('ntp trusted-key 72','Trust the key used by the server association.','ntpAuth'),
      toggle('ntp server 192.0.2.189 key 72 prefer','Associate the reachable preferred reference with the matching key.','ntpServer'),
      ['ntp server 192.0.2.190','Provide a secondary lab time source.']
    ]),
    config('R2',[
      ['ntp master 2','Practice a fallback master setting with a declared stratum.'],
      ['ntp access-group peer TIME-PEERS','Apply an existing management ACL to peer associations.']
    ]),
    exec('R1',[
      ['clock set 14:20:06 10 June 2026','Practice setting the lab clock manually before comparing the synchronization source.'],
      read('show clock detail','Inspect the presented timezone and clock source.','14:20:06.127 EDT Wed Jun 10 2026\nTime source: NTP after synchronization'),
      observe('show ntp associations detail','Confirm reachability, preference and a valid authenticated exchange.',all('ntpAuth','ntpServer'),
        '192.0.2.189 configured, authenticated, our_master, sane, valid, stratum 2','192.0.2.189 configured, reject or unreachable'),
      observe('show ntp status','Verify synchronization and stratum after the key and source are correct.',all('ntpAuth','ntpServer'),
        'Clock is synchronized, stratum 3, reference is 192.0.2.189','Clock is unsynchronized, stratum 16, no reference clock')
    ]),
    config('SW1',[
      toggle('ptp mode boundary','Use a PTP boundary clock profile on a supported switch.','ptp'),
      ['ptp domain 7','Align the PTP domain with the neighboring clock.']
    ]),
    exec('SW1',[
      observe('show ptp clock','Read the local role and domain in the PTP fixture.','ptp','Clock type: Boundary\nDomain: 7\nClock synchronized to upstream grandmaster','PTP not enabled.'),
      observe('show ptp port status','Distinguish upstream and downstream PTP port states.','ptp','Gi0/1  SLAVE\nGi0/2  MASTER','No active PTP ports.')
    ])
  ]),

  lesson({
    id:'syslog-snmp-telemetry',title:'Syslog, SNMPv3 and model-driven telemetry',topics:{encor:['4.1','5.3'],enarsi:['4.2','4.3']},portable:[11],guide:[24,28],
    topology:['R1 · Managed node','PC1 · Simulated NMS','R2 · Routed management path'],
    task:'Set up timestamped logging and read-only telemetry. Use SNMPv3 permissions and verification to distinguish polling from notifications.'
  },[
    config('R1',[
      ['service timestamps log datetime msec show-timezone','Apply timestamps to local and remote log records.'],
      ['logging buffered 32768 informational','Keep recent informational and higher-severity messages locally.'],
      ['logging console warnings','Limit console output to severity 4 and more urgent.'],
      ['logging monitor debugging','Allow VTY log viewing up through debugging with terminal monitor.'],
      ['logging origin-id hostname','Identify the device in forwarded records.'],
      toggle('logging host 192.0.2.194 transport udp port 514','Define the mock syslog collector.','logging'),
      ['logging trap informational','Set the highest numbered severity exported to the collector.'],
      ['logging source-interface Loopback0','Use the stable management address as syslog source.'],
      ['snmp-server community NetraROLab RO MGMT-SOURCES','Practice preserving read-only access and source restrictions for the legacy example.'],
      ['snmp-server view MANAGED ifTable included','Build a view limited to interface information.'],
      ['snmp-server group NMS v3 priv read MANAGED access MGMT-SOURCES','Require privacy and the configured read view.'],
      toggle('snmp-server user POLLER NMS v3 auth sha NetraPollAuthLab priv aes 128 NetraPollPrivLab','Configure a lab-only SNMPv3 authPriv identity.','v3User'),
      ['snmp-server location Netra Edge Room','Set managed location metadata.'],
      ['snmp-server contact Network Operations Lab','Set the lab operations contact.'],
      ['snmp-server enable traps snmp linkdown linkup','Generate interface state notifications for this exercise.'],
      toggle('snmp-server host 192.0.2.194 version 3 priv POLLER','Set the labeled mock notifications destination.','traps')
    ]),
    c('R1',['telemetry ietf subscription 72'],[
      ['encoding encode-kvgpb','Select the subscription’s structured encoding.'],
      ['filter xpath /interfaces-ios-xe-oper:interfaces/interface','Limit this lab subscription to interface state.'],
      ['stream yang-push','Use the model-driven data stream.'],
      ['update-policy periodic 1000','Send periodic updates on the configured interval.'],
      toggle('receiver ip address 192.0.2.194 57500 protocol grpc-tcp','Configure the mock collector address and protocol.','telemetry')
    ]),
    exec('R1',[
      ['terminal monitor','Enable VTY monitoring for this terminal.'],
      observe('show logging','Verify the remote collector and the local record after a port event.','logging',
        s=>'Trap logging: level informational\nLogging to 192.0.2.194 (udp 514)'+(s.linkEvent?'\n%LINK-3-UPDOWN: Interface Gi0/2, changed state to down':''),
        'No configured lab collector.'),
      observe('show snmp user','Read SNMPv3 security and group settings without exposing secrets.','v3User',
        'User name: POLLER · Group-name: NMS\nAuthentication Protocol: SHA\nPrivacy Protocol: AES128','No SNMPv3 user.'),
      observe('show snmp group','Verify the configured v3 group access and read view.','v3User',
        'groupname NMS  security model:v3 priv\nreadview: MANAGED\naccess-list: MGMT-SOURCES','No v3 group in use.'),
      observe('show snmp host','Check the v3 recipient security level.','traps','192.0.2.194  udp/162  version 3  security level priv  user POLLER','No SNMP notification recipient.'),
      observe('show telemetry ietf subscription 72 detail','Check the configured subscription and connection to the mock collector.','telemetry',
        'Subscription ID: 72 · State: Valid · Stream: yang-push\nReceiver 192.0.2.194:57500 (grpc-tcp) · Connected','Subscription 72 not configured.')
    ]),
    c('R1',['interface GigabitEthernet0/2'],[toggle('shutdown','Generate a safe link-down event inside this scenario.','linkEvent')]),
    exec('R1',[
      observe('show logging','Correlate the link event with the local and remote log settings.','logging',
        s=>'Trap logging: level informational\nLogging to 192.0.2.194 (udp 514)'+(s.linkEvent?'\n%LINK-3-UPDOWN: Interface Gi0/2, changed state to down':''),'No configured lab collector.'),
      read('show snmp','Read the packet and error counters without replacing configuration.','SNMP packets input: 4\nUnknown user names: 0\nOutgoing traps: 1'),
      ['terminal no monitor','Stop streaming log events to this terminal.']
    ])
  ]),

  lesson({
    id:'netflow-ipfix',title:'Flexible NetFlow, v9 and IPFIX',topics:{encor:['4.2'],enarsi:['4.6']},portable:[11],guide:[24],
    topology:['PC1 · Synthetic flow source','R1 · Ingress monitor','PC2 · Mock collector'],
    task:'Build a reusable flow record, attach the exporter and monitor, and verify the difference between the populated cache and successful export.'
  },[
    c('R1',['flow record CAMPUS-IPV4'],[
      ['match ipv4 source address','Key a flow by the observed source address.'],
      ['match ipv4 destination address','Key a flow by destination.'],
      ['match ipv4 protocol','Distinguish transport protocols.'],
      ['match transport source-port','Distinguish source application flows.'],
      ['match transport destination-port','Track destination services separately.'],
      ['collect counter bytes long','Collect byte totals using a wide counter.'],
      ['collect counter packets long','Collect packet totals using a wide counter.'],
      ['collect timestamp sys-uptime first','Collect the first-packet timestamp.'],
      toggle('collect timestamp sys-uptime last','Collect the last-packet timestamp for export.','record')
    ]),
    c('R1',['flow exporter NMS-EXPORT'],[
      toggle('destination 192.0.2.198','Send export datagrams to the simulated collector.','destination'),
      ['source Loopback0','Use the expected exporter address.'],
      ['transport udp 2055','Set the lab collector’s UDP port.'],
      toggle('export-protocol netflow-v9','Send v9 templates and data records.','v9'),
      ['template data timeout 60','Refresh templates periodically.'],
      toggle('export-protocol ipfix','Select IPFIX as the final exporter format.','ipfix')
    ]),
    c('R1',['flow monitor EDGE-MONITOR'],[
      ['record CAMPUS-IPV4','Attach the record to define flow keys and collected fields.'],
      toggle('exporter NMS-EXPORT','Send sampled records to the configured exporter.','monitor'),
      ['cache timeout active 60','Set an export interval for flows that continue.'],
      ['cache timeout inactive 15','Age out a flow that stops sending packets.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      toggle('ip flow monitor EDGE-MONITOR input','Attach the monitor before generating inbound traffic.','applied')
    ]),
    exec('R1',[
      observe('show flow monitor EDGE-MONITOR cache','Inspect the current flow cache.','sample',
        'IPV4 SRC ADDR      IPV4 DST ADDR      PROT  PKTS  BYTES\n10.72.0.29        203.0.113.8        6     3     348','Cache contains zero entries.')
    ]),
    shell('PC1',[
      ['curl -I https://203.0.113.8','Generate one matching synthetic HTTPS flow.',s=>{s.sample=all('record','monitor','applied')(s);},()=> 'HTTP/1.1 200 OK']
    ]),
    exec('R1',[
      observe('show flow monitor EDGE-MONITOR cache','Verify the flow was captured at the intended direction.','sample',
        'IPV4 SRC ADDR      IPV4 DST ADDR      PROT  PKTS  BYTES\n10.72.0.29        203.0.113.8        6     3     348','Cache contains zero entries.'),
      observe('show flow exporter NMS-EXPORT statistics','Verify the collector destination and simulated exported datagrams.',all('destination','monitor','ipfix','sample'),
        'Transport: UDP 2055; export protocol: IPFIX\nSuccessfully sent: 1 packet; failed: 0','No export sent; check collector or monitor.'),
      read('show flow interface GigabitEthernet0/0','Inspect the actual ingress monitor attachment.','Gi0/0\n  Input: EDGE-MONITOR\n  Output: none'),
      read('show flow record CAMPUS-IPV4','Inspect match keys and collected non-key fields.','Record CAMPUS-IPV4\nMatch: v4 source/destination, protocol, src/dst ports\nCollect: bytes, packets, first/last uptime'),
      ['clear flow monitor EDGE-MONITOR cache','Reset the sample cache inside the scenario.',assign({sample:false}),()=> 'Flow monitor cache cleared.']
    ])
  ]),

  lesson({
    id:'span-rspan-erspan',title:'SPAN, RSPAN and ERSPAN',topics:{encor:['4.3'],enarsi:[]},portable:[11],guide:[24],
    topology:['SW1 · Source','SW2 · Remote analyzer port','R1 · Routed ERSPAN transit'],
    task:'Mirror traffic locally, across a dedicated VLAN, and through a routed ERSPAN tunnel. Check that the destination is not an ordinary access port.'
  },[
    config('SW1',[
      ['monitor session 7 source interface GigabitEthernet0/1 both','Mirror ingress and egress from the selected source.'],
      toggle('monitor session 7 destination interface GigabitEthernet0/8','Send mirrored frames to the local analyzer port.','span'),
      ['monitor session 8 source vlan 72 rx','Select incoming traffic in a specific VLAN.']
    ]),
    c('SW1',['vlan 707'],[
      toggle('remote-span','Mark a dedicated RSPAN carrier VLAN.','rspanVlan')
    ]),
    config('SW1',[
      ['monitor session 8 destination remote vlan 707','Transmit the RSPAN copy over the carrier VLAN.']
    ]),
    c('SW2',['vlan 707'],[
      ['remote-span','Define the same RSPAN VLAN downstream.']
    ]),
    config('SW2',[
      ['monitor session 8 source remote vlan 707','Receive mirrored traffic from the RSPAN carrier.'],
      toggle('monitor session 8 destination interface GigabitEthernet0/8','Deliver the copy to the remote analyzer.','rspanDest')
    ]),
    c('SW1',['monitor session 72 type erspan-source'],[
      ['source interface GigabitEthernet0/2 rx','Select the ingress stream to encapsulate with ERSPAN.'],
      ['no shutdown','Enable the ERSPAN source session.']
    ]),
    c('SW1',['monitor session 72 type erspan-source','destination'],[
      ['erspan-id 72','Match the stream identifier at the routed capture endpoint.'],
      ['ip address 198.51.100.202','Set the remote ERSPAN destination.'],
      toggle('origin ip address 192.0.2.202','Select the routable source IP for the GRE-encapsulated copy.','erspan')
    ]),
    exec('SW1',[
      observe('show monitor session 7','Confirm local source and destination ports.','span',
        'Session 7: Local Session\nSource: Gi0/1 (both)\nDestination: Gi0/8','No local SPAN destination.'),
      observe('show monitor session 72 detail','Verify the active ERSPAN attributes.',all('erspan'),
        'Session 72: ERSPAN Source\nSource: Gi0/2 (rx)\nOrigin 192.0.2.202 -> 198.51.100.202\nERSPAN ID: 72','ERSPAN destination incomplete.')
    ]),
    exec('SW2',[
      observe('show monitor session 8','Verify the RSPAN VLAN selected as the source.',all('rspanVlan','rspanDest'),
        'Session 8: RSPAN Destination\nSource RSPAN VLAN 707\nDestination Gi0/8','RSPAN session incomplete.')
    ])
  ]),

  lesson({
    id:'jitter-and-diagnostics',title:'IP SLA jitter, tracking and conditional diagnostics',topics:{encor:['4.1','4.4'],enarsi:['4.3','4.5']},portable:[6,11],guide:[24],
    topology:['R1 · Probe source','R2 · IOS SLA responder','PC1 · Branch path'],
    task:'Create a timestamped jitter test and compare it with CLI reachability and path discovery. Use bounded debug output inside the scenario.'
  },[
    config('R2',[
      toggle('ip sla responder','Enable the simulated responder for timestamped measurements.','responder')
    ]),
    c('R1',['ip sla 73'],[
      toggle('udp-jitter 192.0.2.210 16384 source-ip 192.0.2.209 num-packets 10 interval 20','Generate timestamped probes to a specific responder port.','jitter'),
      ['frequency 30','Set the operation repeat interval.'],
      ['timeout 3000','Bound the time allowed for a result.'],
      ['request-data-size 160','Set the simulated payload bytes.']
    ]),
    config('R1',[
      toggle('ip sla schedule 73 life forever start-time now','Start the operation without waiting for a future window.','scheduled')
    ]),
    c('R1',['track 73 ip sla 73 state'],[
      ['delay down 8 up 15','Delay transitions for paths with brief intermittent errors.']
    ]),
    exec('R1',[
      observe('show ip sla configuration 73','Check the operation type, sample count and schedule.',all('jitter','scheduled'),
        'Entry number: 73\nType of operation: udp-jitter\nTarget address/port: 192.0.2.210/16384\nNumber of packets: 10 Frequency: 30','Operation 73 is incomplete or unscheduled.'),
      observe('show ip sla statistics 73 details','Read RTT, jitter and loss independently.',all('responder','scheduled','jitter'),
        'Latest operation return code: OK\nRTT Min/Avg/Max: 4/6/9 ms\nSource-to-destination jitter Avg: 2 ms\nPackets lost: 0/10','Return code: Timeout'),
      observe('show track 73','Compare the track state with the full SLA result.',all('responder','scheduled','jitter'),'Track 73 IP SLA 73 state is Up','Track 73 IP SLA 73 state is Down'),
      read('ping 192.0.2.210 source 192.0.2.209 repeat 5','Use a specified source to mirror the lab probe path.','!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 4/6/9 ms'),
      read('traceroute 203.0.113.73 source 192.0.2.209 numeric','Identify the hop at which the path changes.','1 192.0.2.210 4 msec\n2 198.51.100.73 6 msec\n3 203.0.113.73 9 msec'),
      ['debug condition interface GigabitEthernet0/0','Scope the example debug to a single interface.'],
      read('show debugging','Confirm that the selected diagnostic condition is active.','Interface condition 1: GigabitEthernet0/0'),
      read('debug ip icmp','Inspect the fixture’s relevant ICMP event.','ICMP: echo reply received from 192.0.2.210 on Gi0/0'),
      ['undebug all','Stop all scenario debugging.',null,()=> 'All debugging has been turned off.'],
      ['no debug condition interface GigabitEthernet0/0','Remove the device condition.']
    ])
  ]),

  lesson({
    id:'qos-mark-and-queue',title:'QoS classification, marking, policing and shaping',topics:{encor:['1.4','5.2.b'],enarsi:['3.3','4.5']},portable:[10,11],guide:[14,26],
    topology:['PC1 · Voice test endpoint','R1 · Branch edge','R2 · WAN handoff'],
    task:'Classify voice and video, cap the parent rate with shaping, and verify real matching counters inside the guided console.'
  },[
    c('R1',['class-map match-any VOICE-TRAFFIC'],[
      ['match dscp ef','Identify packets marked Expedited Forwarding.']
    ]),
    c('R1',['class-map match-any VIDEO-TRAFFIC'],[
      ['match dscp af41','Identify the video service class.']
    ]),
    c('R1',['policy-map WAN-CHILD','class VOICE-TRAFFIC'],[
      toggle('priority percent 15','Reserve a bounded low-latency queue for voice.','voiceQueue'),
      ['set dscp ef','Maintain or apply the EF marking.']
    ]),
    c('R1',['policy-map WAN-CHILD','class VIDEO-TRAFFIC'],[
      ['bandwidth percent 30','Guarantee this class a share of bandwidth during congestion.'],
      ['police 6000000 conform-action transmit exceed-action drop','Demonstrate dropping excess traffic at the policing rate.']
    ]),
    c('R1',['policy-map WAN-CHILD','class class-default'],[
      ['fair-queue','Share the remaining class bandwidth among flows where supported.'],
      ['random-detect dscp-based','Practice early drop differentiated by DSCP on supported platforms.']
    ]),
    c('R1',['policy-map WAN-PARENT','class class-default'],[
      ['shape average 20000000','Pace output traffic to a slower 20-Mbit/s service.'],
      ['service-policy WAN-CHILD','Apply class scheduling inside the shaped parent.']
    ]),
    c('R1',['interface GigabitEthernet0/1'],[
      toggle('service-policy output WAN-PARENT','Attach the nested policy at the WAN egress.','qos')
    ]),
    shell('PC1',[
      ['ping -Q 184 -c 5 203.0.113.174','Send five simulated EF-marked probes.',s=>{if(all('voiceQueue','qos')(s))s.voice=(s.voice??0)+5;},()=> '5 packets transmitted, 5 received.']
    ]),
    exec('R1',[
      observe('show policy-map interface GigabitEthernet0/1','Read shaping, priority and classification counters.',all('voiceQueue','qos'),
        s=>'Service-policy output: WAN-PARENT\n  Shape average 20000000\n  Child policy WAN-CHILD\n  VOICE-TRAFFIC  priority 15%  '+(s.voice??0)+' packets\n  VIDEO-TRAFFIC  bandwidth 30%','No matching service policy attached.'),
      read('show class-map VOICE-TRAFFIC','Review the classification condition.','Class Map match-any VOICE-TRAFFIC\n  Match dscp ef (46)'),
      read('show policy-map WAN-PARENT','Check attachment of the child policy inside the shape.','Policy Map WAN-PARENT\n  Class class-default\n    shape average 20000000\n    service-policy WAN-CHILD')
    ])
  ])
];
