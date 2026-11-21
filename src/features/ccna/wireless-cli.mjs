import { set, lines } from './engine.mjs';
import { helpers } from './network-labs.mjs';
import { apJoined, testWireless, wirelessConfig, wirelessScenarios } from './wireless.mjs';

const { sw, pc, enable, config, end, exit, port, show } = helpers;
const wlc = 'WLC1';
const branch = wirelessScenarios.find(scenario => scenario.id === 'branch');
const branchLink = state => {
  const c = state.config;
  return lines('Port     Mode   Encapsulation  Status     Native vlan',
    `Gi0/24   on     802.1q         ${c.apPort === 'trunk' ? 'trunking' : 'off'}   ${c.apNative}`,
    `Vlans allowed on trunk: ${c.apVlans.join(',')}`);
};

function connect(state) {
  state.last = testWireless(state.config, branch.client, branch);
  return lines(...state.last.events.map(event => `${event.stage}: ${event.detail}`));
}

export const wirelessCli = {
  id:'wireless-troubleshooting',domain:2,title:'Wireless controller and FlexConnect troubleshooting',objectives:'2.6–2.9 · 5.10',source:'Vol. 1 · Ch. 26–29 · Catalyst 9800 verification',
  devices:[wlc,sw,pc],topology:['PC1 · 0200.0000.0021','AP-01 · FlexConnect','SW1 Gi0/24','WLC1'],
  task:'Confirm that the AP is joined and the SSID is enabled. Trace a client on the branch WLAN from association to DHCP, then repair its switch trunk.',
  initial:{ config:wirelessConfig(branch), last:null },
  steps:[
    enable(wlc),
    show(wlc,'show ap summary','Confirm the AP joined. A visible SSID does not prove that its client VLAN is reachable.',s=>apJoined(s.config)?'Number of APs: 1\nAP-01   Registered   192.168.99.31':'Number of APs: 0'),
    show(wlc,'show ap tag summary','Identify the site, policy and RF tags applied to the AP.',s=>apJoined(s.config)?'AP Name   Policy Tag    Site Tag      RF Tag\nAP-01     BRANCH        BRANCH-FLEX   default-rf-tag':'No AP tags to display.'),
    show(wlc,'show wlan summary','Verify the guest WLAN is enabled.',s=>`ID  Profile Name  SSID         Status\n20  GUEST         ${s.config.ssid}  ${s.config.enabled?'Enabled':'Disabled'}`),
    show(wlc,'show wireless tag policy detailed BRANCH','Check that the policy tag links the WLAN and policy profile.',s=>s.config.tag?'WLAN Profile: GUEST\nPolicy Profile: GUEST-POLICY':'No WLAN-to-policy mappings.'),
    show(wlc,'show wireless profile policy detailed GUEST-POLICY','Verify the client VLAN and local switching policy.',s=>`VLAN: ${s.config.vlan}\nCentral Switching: ${s.config.forwarding==='central'?'Enabled':'Disabled'}`),
    [pc,'netsh wlan connect name=Netra-Guest','Attempt to connect using the saved guest profile.',connect],
    show(wlc,'show wireless client summary','Distinguish a client that associated from a client in RUN state.',s=>`Number of clients: ${s.last?.connected?1:0}${s.last?.connected?'\n0200.0000.0021  AP-01  WLAN 20  '+(s.last.lease?'Run':'IP Learn'):''}`),
    enable(sw),
    show(sw,'show interfaces trunk','Find the missing guest VLAN on the AP switchport.',branchLink),
    config(sw),port(sw,'GigabitEthernet0/24'),
    [sw,'switchport trunk allowed vlan add 20','Preserve VLAN 99 and add guest VLAN 20 to the existing allowlist.',s=>{s.config.apVlans=[...new Set([...s.config.apVlans,20])].sort((a,b)=>a-b);}],
    end(sw),show(sw,'show interfaces trunk','Confirm the trunk now allows VLANs 20 and 99.',branchLink),
    [pc,'netsh wlan connect name=Netra-Guest','Reconnect and repeat the full client test.',connect],
    show(pc,'ipconfig /all','Verify the client received a lease in 192.168.20.0/24.',s=>s.last?.lease?`IPv4 Address: ${s.last.lease}\nSubnet Mask: 255.255.255.0\nDefault Gateway: 192.168.20.1`:'IPv4 Address: unassigned'),
    show(pc,'ping 192.168.20.1','Verify first-hop reachability after DHCP.',s=>s.last?.success?'Reply from 192.168.20.1: bytes=32 time<1ms':'Request timed out.'),
    show(wlc,'show wireless client mac-address 0200.0000.0021 detail','Verify the client state, applied policy, VLAN and IPv4 address.',s=>s.last?.connected?lines('Client MAC Address: 0200.0000.0021','AP Name: AP-01','Policy Profile: GUEST-POLICY',`VLAN: ${s.config.vlan}`,`Client State: ${s.last.lease?'Run':'IP Learn'}`,`Client IPv4 Address: ${s.last.lease??'unassigned'}`):'Client not found.'),
    show(wlc,'show wireless client summary','Confirm the same client now reaches RUN state.',s=>s.last?.lease?'0200.0000.0021  AP-01  WLAN 20  Run':'No client in RUN state.')
  ]
};

const campus = wirelessScenarios.find(scenario => scenario.id === 'campus');
const configureWlan = (key,value) => state => {state.config[key]=value;};

export const wirelessSetupCli = {
  id:'wireless-setup',domain:2,title:'Create a WPA2 WLAN on the controller',objectives:'2.9 · 5.10',source:'Vol. 1 · Ch. 29 · Catalyst 9800 CLI',
  devices:[wlc,pc],topology:['PC1','AP-01 · Local','WLC1 · VLAN 10'],
  task:'Configure a WPA2-PSK WLAN profile, map it to an enabled VLAN 10 policy under the AP’s preassigned CAMPUS tag, then test wireless access.',
  initial:{config:{...wirelessConfig(campus),security:'open'},last:null},
  steps:[
    enable(wlc),config(wlc),
    [wlc,'wlan STAFF 10 Netra-Staff','Create WLAN profile STAFF, ID 10, using Netra-Staff as the broadcast SSID.',set('profile',true)],
    [wlc,'security wpa wpa2','Enable WPA2 on the WLAN.',set('wpa2',true)],
    [wlc,'security wpa wpa2 ciphers aes','Select the AES cipher for WPA2.',set('aes',true)],
    [wlc,'no security wpa akm dot1x','Remove enterprise 802.1X AKM for this Personal profile.',set('dot1x',false)],
    [wlc,'security wpa akm psk','Select pre-shared key authentication.',configureWlan('security','wpa2')],
    [wlc,'security wpa psk set-key ascii 0 NetraStaff26','Set a fictitious ASCII passphrase for this lab.',configureWlan('key','NetraStaff26')],
    [wlc,'no shutdown','Enable the WLAN profile.',configureWlan('enabled',true)],exit(wlc),
    [wlc,'wireless profile policy STAFF-POLICY','Create the policy profile that handles client forwarding.',set('policy',true)],
    [wlc,'vlan 10','Map clients to VLAN 10 on the controller uplink.',configureWlan('vlan',10)],
    [wlc,'no shutdown','Enable the policy profile.',configureWlan('policyEnabled',true)],exit(wlc),
    [wlc,'wireless tag policy CAMPUS','Edit the policy tag already assigned to AP-01.'],
    [wlc,'wlan STAFF policy STAFF-POLICY','Bind the WLAN profile to the policy profile.',configureWlan('tag',true)],end(wlc),
    show(wlc,'show wlan summary','Verify the staff SSID is enabled.',s=>s.profile?`10  STAFF  ${s.config.ssid}  ${s.config.enabled?'Enabled':'Disabled'}`:'No WLAN profile.'),
    show(wlc,'show wireless tag policy detailed CAMPUS','Confirm the AP tag has the correct mapping.',s=>s.config.tag?'WLAN Profile: STAFF\nPolicy Profile: STAFF-POLICY':'No WLAN-to-policy mappings.'),
    [pc,'netsh wlan connect name=Netra-Staff','Test a client with the matching saved profile and lab PSK.',s=>{
      if (!s.wpa2 || !s.aes || !s.profile || !s.policy || s.dot1x !== false) return 'Verify the profile, WPA2 AES and PSK authentication configuration.';
      s.last=testWireless(s.config,campus.client,campus);
      return lines(...s.last.events.map(event=>`${event.stage}: ${event.detail}`));
    }],
    show(pc,'ipconfig /all','Verify the client obtained a VLAN 10 address.',s=>s.last?.lease?`IPv4 Address: ${s.last.lease}
Default Gateway: 192.168.10.1`:'IPv4 Address: unassigned'),
    show(wlc,'show wireless client summary','The client has reached RUN after joining and obtaining its lease.',s=>s.last?.success?'0200.0000.0021  AP-01  WLAN 10  Run':'No client in RUN state.')
  ]
};
