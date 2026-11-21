import { networkLabs, helpers } from './network-labs.mjs';
import { servicesLabs } from './services-labs.mjs';
import { set, lines } from './engine.mjs';

export const domains = [
  {id:1, title:'Network Fundamentals', weight:20},
  {id:2, title:'Network Access', weight:20},
  {id:3, title:'IP Connectivity', weight:25},
  {id:4, title:'IP Services', weight:10},
  {id:5, title:'Security Fundamentals', weight:15},
  {id:6, title:'Automation and Programmability', weight:10}
];

const { sw, r, pc, enable, config, end, exit, port, show } = helpers;
const extra = [
  {
    id:'switch-management',domain:1,title:'Switch management, SVI and gateway',objectives:'1.4 · 1.6 · 2.8',source:'Vol. 1 · Ch. 6–7',
    devices:[sw],topology:['Admin PC','VLAN 99 management','SW1'],task:'Address an SVI on a Layer 2 switch and set its management default gateway.',
    steps:[enable(sw),config(sw),[sw,'vlan 99','Create the management VLAN.',set('vlan',true)],exit(sw),
      port(sw,'GigabitEthernet0/24'),[sw,'switchport mode access','Set an access link to this lab’s upstream network.'],[sw,'switchport access vlan 99','Place the active uplink in VLAN 99.',set('uplink',true)],exit(sw),
      port(sw,'Vlan 99'),[sw,'ip address 192.168.99.11 255.255.255.0','Assign a management address.',set('ip',true)],[sw,'no shutdown','Enable the switch virtual interface.',set('up',true)],exit(sw),
      [sw,'ip default-gateway 192.168.99.1','Set the Layer 2 switch’s management next hop.',set('gw',true)],end(sw),
      show(sw,'show ip interface brief','Verify the management SVI and active member.',s=>`Vlan99  ${s.ip?'192.168.99.11':'unassigned'}  ${s.up&&s.uplink&&s.vlan?'up/up':'down/down'}`),
      show(sw,'ping 192.168.99.1','Verify the local gateway responds from the SVI.',s=>s.ip&&s.up&&s.vlan&&s.uplink?'!!!!!\nSuccess rate is 100 percent (5/5)':'.....\nSuccess rate is 0 percent (0/5)'),
      [sw,'show running-config','Confirm the configured default gateway.']]
  },
  {
    id:'qos',domain:4,title:'QoS classification and marking',objectives:'4.7',source:'Vol. 2 · Ch. 11',
    devices:[r,pc],topology:['Voice source','Ingress Gi0/0','R1'],task:'Classify DSCP EF, attach a traffic policy and inspect the matching packet counter.',
    steps:[enable(r),config(r),[r,'class-map match-any VOICE','Create a class matching any of its conditions.',set('classMap',true)],
      [r,'match dscp ef','Classify traffic already marked Expedited Forwarding.',set('match',true)],exit(r),
      [r,'policy-map EDGE-QOS','Create a policy for matching traffic.',set('policy',true)],
      [r,'class VOICE','Select the traffic class in the policy.',set('selected',true)],[r,'set dscp ef','Preserve the EF marking when the policy matches.',set('mark',true)],end(r),
      config(r),port(r,'GigabitEthernet0/0'),[r,'service-policy input EDGE-QOS','Attach the policy at ingress.',set('attached',true)],end(r),
      [pc,'ping -Q 184 203.0.113.10','Send five synthetic Linux-style probes with DSCP 46 and ECN 0.',s=>{const applied=s.classMap&&s.match&&s.policy&&s.selected&&s.attached;s.packets=(s.packets??0)+(applied?5:0);return applied?'5 packets classified VOICE; DSCP EF.':'5 packets sent; ingress class did not match.';}],
      show(r,'show policy-map interface GigabitEthernet0/0','Read the packet count for the attached class.',s=>s.attached?lines('Service-policy input: EDGE-QOS',`Class-map: VOICE, ${s.packets??0} packets`,s.mark?'Set dscp ef':'Marking not configured'):'No service policy attached.')]
  },
  {
    id:'rest-api',domain:6,title:'REST requests and JSON',objectives:'6.5 · 6.7',source:'Vol. 2 · Ch. 18',
    devices:[pc],topology:['PC1', 'Simulated REST API', 'Device inventory'],task:'Create, read, update and delete a lab inventory entry. Inspect JSON and HTTP status codes.',
    steps:[
      show(pc,'curl -i https://api.netra.example/devices','GET the collection. Inspect its JSON array and status code.',s=>lines('HTTP/1.1 200 OK','Content-Type: application/json','',JSON.stringify(s.item?[s.item]:[],null,2))),
      [pc,`curl -i -X POST -H 'Content-Type: application/json' -d '{"name":"SW1","managed":true}' https://api.netra.example/devices`,'POST a JSON object with a string and a Boolean to create a resource.',s=>{if(s.item)return 'HTTP/1.1 409 Conflict';s.item={id:1,name:'SW1',managed:true};return lines('HTTP/1.1 201 Created','Location: /devices/1','',JSON.stringify(s.item,null,2));}],
      show(pc,'curl -i https://api.netra.example/devices/1','Read the new resource by URI.',s=>s.item?lines('HTTP/1.1 200 OK','',JSON.stringify(s.item,null,2)):'HTTP/1.1 404 Not Found'),
      [pc,`curl -i -X PATCH -H 'Content-Type: application/json' -d '{"managed":false}' https://api.netra.example/devices/1`,'PATCH only the managed field; confirm the name and ID are retained.',s=>{if(!s.item)return 'HTTP/1.1 404 Not Found';s.item.managed=false;return lines('HTTP/1.1 200 OK','',JSON.stringify(s.item,null,2));}],
      [pc,'curl -i -X DELETE https://api.netra.example/devices/1','Delete the resource inside this simulation.',s=>{if(!s.item)return 'HTTP/1.1 404 Not Found';delete s.item;return 'HTTP/1.1 204 No Content';}],
      show(pc,'curl -i https://api.netra.example/devices/1','Verify the deleted resource now returns 404.',s=>s.item?lines('HTTP/1.1 200 OK','',JSON.stringify(s.item,null,2)):'HTTP/1.1 404 Not Found')
    ]
  }
];

export const labs = [...networkLabs, ...servicesLabs, ...extra].sort((a,b)=>a.domain-b.domain);
export const commandCount = new Set(labs.flatMap(lab=>lab.steps.map(step=>step[1].toLowerCase()))).size;
