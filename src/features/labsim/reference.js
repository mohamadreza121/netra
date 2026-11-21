import { commandReference } from '../ccna/catalog.mjs';

// These entries link to the CCNA study material, including variants beyond the device console.
export const guidedTopics = [
  {types:['router','switch'],title:'Console, VTY and SSH',source:'Vol. 1 ch. 4, 6 · Vol. 2 ch. 5',terms:'line console 0 · line vty · login · login local · password · username secret · enable secret · transport input ssh · ip domain-name · crypto key generate rsa · service password-encryption · show ip ssh · show ssh · access-class'},
  {types:['router','switch'],title:'Logging, time and management',source:'Vol. 2 ch. 9, 12',terms:'logging host · logging console · logging monitor · logging buffered · show logging · terminal monitor · clock set · clock timezone · clock summer-time · ntp server · ntp master · ntp source · show ntp associations · show ntp status · debug · undebug all · snmp-server'},
  {types:['router','switch'],title:'Files, boot and reload',source:'Vol. 1 ch. 4 · Vol. 2 ch. 12 and app. F',terms:'copy tftp running-config · copy running-config tftp · copy startup-config running-config · show flash · dir · verify /md5 · boot system · ip ftp username · ip ftp password · archive · archive config · configure replace · write erase · reload · config-register'},
  {types:['switch'],title:'DTP, VTP and switch hardware',source:'Vol. 1 ch. 8, 10, 17',terms:'switchport mode dynamic auto · switchport mode dynamic desirable · switchport trunk encapsulation dot1q · vtp mode · show vtp status · sdm prefer lanbase-routing · interface port-channel · show etherchannel detail'},
  {types:['switch'],title:'DHCP snooping and Dynamic ARP Inspection',source:'Vol. 2 ch. 6, 8',terms:'ip dhcp snooping limit rate · ip dhcp snooping information option · ip arp inspection validate · errdisable recovery cause · errdisable recovery interval'},
  {types:['router'],title:'IPv6 dynamic addressing',source:'Vol. 1 ch. 24–25',terms:'ipv6 address autoconfig · ipv6 address dhcp · ipv6 address eui-64 · ipv6 address anycast · ipv6 route with interface and link-local next hop'},
  {types:['router'],title:'Routing extensions and troubleshooting',source:'Vol. 1 ch. 20–21 and app. Q',terms:'clear ip ospf process · debug ip ospf adj · debug ip ospf events · debug ip ospf hello · show ip eigrp interfaces · show ip eigrp neighbors · show ip route eigrp'},
  {types:['router','switch'],title:'QoS and service policies',source:'Vol. 2 ch. 11',terms:'class-map match-any · match dscp · policy-map · class · set dscp · priority · bandwidth percent · police · shape average · service-policy input · show policy-map interface'},
  {types:['ap','wlc'],title:'Controller-managed WLANs',source:'Vol. 1 ch. 26–29 · CCNA controller practice',terms:'wlan · wireless profile policy · wireless tag policy · wireless management interface · show wlan summary · show wireless client summary · CAPWAP · FlexConnect · RADIUS · 802.1X · WPA2-Enterprise'}
];

export function guidedEntries(type) {
  const device = {router:/^R\d/,switch:/^SW/,ap:/^AP/,wlc:/^WLC/,pc:/^PC/}[type];
  if(!device)return [];
  const seen=new Set();
  return commandReference.filter(entry=>{
    const key=entry.command.toLowerCase();
    if(!device.test(entry.device)||seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
