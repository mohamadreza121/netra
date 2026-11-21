const baseline = {
  ssid:'Netra-Staff', security:'wpa2', key:'NetraStaff26', enabled:true, policyEnabled:true, tag:true,
  vlan:10, forwarding:'central', apMode:'local', poe:true, controllerReachable:true,
  apPort:'access', apNative:99, wlcVlans:[10,20,99], apVlans:[99], flexVlans:[],
  scopes:[10,20], gateways:[10,20], band:'5', channel:36, nearby:true, qos:'Best effort', radius:true
};

export const sampleClient = {ssid:'Netra-Staff', security:'wpa2', key:'NetraStaff26', band:'dual', username:'', password:''};
const guestClient = { ...sampleClient, ssid:'Netra-Guest',key:'NetraGuest26',band:'dual' };
const campus = {
  id:'campus', name:'Build a campus WLAN', description:'Bring a staff WLAN online using WPA2-PSK, a policy tag and central switching. The WLC uplink carries client VLAN 10. Use the lab passphrase NetraStaff26.',
  target:10, forwarding:'central', cleanRf:false,
  config:{ enabled:false, policyEnabled:false, tag:false, key:'' }, client:sampleClient
};

export const wirelessScenarios = [
  campus,
  {
    id:'psk', name:'SSID visible, client rejected', description:'A staff laptop sees Netra-Staff but never gets a lease. Trace the failure and restore access; the help desk’s current lab PSK is NetraStaff26.',
    target:10,forwarding:'central',cleanRf:false,
    config:{ key:'NetraStaff26' },client:{...sampleClient,key:'OldStaffKey26'}
  },
  {
    id:'branch', name:'FlexConnect branch VLAN', description:'A branch AP should switch Netra-Guest locally to VLAN 20. Verify CAPWAP, the mapped Flex VLAN, and the AP switchport. Management is native VLAN 99.',
    target:20,forwarding:'local',cleanRf:false,
    config:{ssid:'Netra-Guest',key:'NetraGuest26',vlan:20,forwarding:'local',apMode:'flex',apPort:'trunk',apNative:99,apVlans:[99],flexVlans:[20]},client:guestClient
  },
  {
    id:'central-trunk', name:'Campus controller trunk', description:'AP-01 joins and the staff device authenticates, but it has no IP address. Central switching is required. Trace where VLAN 10 leaves the wireless infrastructure.',
    target:10,forwarding:'central',cleanRf:false,
    config:{wlcVlans:[20,99]},client:sampleClient
  },
  {
    id:'dhcp-scope', name:'Wi-Fi connected, no IPv4 lease', description:'Netra-Staff association works and the uplinks carry VLAN 10. Restore DHCP for this VLAN and confirm the client gets a lease and can reach its gateway.',
    target:10,forwarding:'central',cleanRf:false,
    config:{scopes:[20]},client:sampleClient
  },
  {
    id:'rf', name:'2.4 GHz channel planning', description:'A legacy client needs 2.4 GHz. A neighboring AP uses channel 6. Keep connectivity and choose a nonoverlapping channel in this 20 MHz lab.',
    target:10,forwarding:'central',cleanRf:true,
    config:{band:'2.4',channel:4},client:{...sampleClient, band:'2.4'}
  },
  {
    id:'enterprise', name:'WPA2-Enterprise and RADIUS', description:'A staff client needs 802.1X. Restore the lab RADIUS service, match WPA2-Enterprise, and test with the fictitious credentials analyst / NetraRadius26.',
    target:10,forwarding:'central',cleanRf:false,
    config:{security:'enterprise',radius:false},client:{...sampleClient,security:'enterprise',username:'analyst',password:'NetraRadius26'}
  }
];

export function wirelessConfig(scenario) {
  return structuredClone({ ...baseline, ...scenario.config });
}

export function apJoined(c) {
  const managementOk = c.apNative === 99 && (c.apPort === 'access' || c.apVlans.includes(99));
  return c.poe && managementOk && c.controllerReachable;
}

export function testWireless(c, client, scenario) {
  const events = [];
  const report = (stage, state, detail) => events.push({stage,state,detail});
  const stop = (stage, detail, connected = false) => {
    report(stage,'fail',detail);
    return { events, connected, success:false };
  };
  if (!c.poe) return stop('AP power','The AP is offline. Check the PoE source.');
  report('AP power','pass','AP-01 is powered.');
  if (!apJoined(c)) return stop('CAPWAP','AP-01 cannot join WLC-01. Check management VLAN 99, the AP switchport, and IP reachability.');
  report('CAPWAP','pass',`AP-01 joined WLC-01 in ${c.apMode === 'flex' ? 'FlexConnect' : 'Local'} mode.`);
  if (!c.enabled || !c.policyEnabled || !c.tag) return stop('Discovery','SSID is unavailable on AP-01. Verify the WLAN and policy are enabled and mapped by the AP policy tag.');
  if (client.ssid !== c.ssid || (client.band !== 'dual' && client.band !== c.band)) return stop('Discovery','Client cannot see this WLAN. Compare the SSID and supported radio band.');
  report('Discovery','pass',`${c.ssid} found on ${c.band} GHz · channel ${c.channel} · 20 MHz.`);
  if (client.security !== c.security) return stop('Authentication','The client security mode differs from the WLAN.');
  if (['wpa2','wpa3'].includes(c.security) && client.key !== c.key) return stop('Authentication',c.security === 'wpa3' ? 'SAE authentication failed. Check the client password.' : 'WPA2 key negotiation failed. Check the client PSK.');
  if (c.security === 'enterprise') {
    if (!c.radius) return stop('802.1X','No RADIUS response. Verify AAA server reachability before changing the credentials.');
    if (client.username !== 'analyst' || client.password !== 'NetraRadius26') return stop('802.1X','RADIUS Access-Reject. Verify the lab identity and password.');
    report('802.1X','pass','EAP completed · RADIUS Access-Accept.');
  }
  report('Association','pass',`Client associated to AP-01 · ${c.security === 'wpa3' ? 'SAE' : c.security === 'wpa2' ? 'WPA2-PSK / AES' : c.security === 'enterprise' ? 'WPA2-Enterprise' : 'Open'}.`);
  if (c.forwarding === 'local') {
    if (c.apMode !== 'flex' || !c.flexVlans.includes(c.vlan)) return stop('Forwarding','Local switching requires a FlexConnect AP and the client VLAN in the Flex profile.',true);
    if (c.apPort !== 'trunk' || !c.apVlans.includes(c.vlan)) return stop('Forwarding',`VLAN ${c.vlan} cannot leave the AP uplink. Allow it on the branch trunk.`,true);
    report('Forwarding','pass',`AP-01 bridges frames locally to VLAN ${c.vlan} on the AP trunk.`);
  } else {
    if (!c.wlcVlans.includes(c.vlan)) return stop('Forwarding',`VLAN ${c.vlan} is missing from the WLC uplink trunk.`,true);
    report('Forwarding','pass',`Client data is tunneled by CAPWAP and exits WLC-01 on VLAN ${c.vlan}.`);
  }
  if (!c.scopes.includes(c.vlan)) return stop('DHCP','Discover timed out. Check that a DHCP scope exists for this VLAN.',true);
  const lease = `192.168.${c.vlan}.21`;
  const gateway = `192.168.${c.vlan}.1`;
  report('DHCP','pass',`Discover → Offer → Request → ACK · ${lease}/24 · gateway ${gateway}.`);
  if (!c.gateways.includes(c.vlan)) return stop('Gateway',`Client has a lease but ${gateway} does not answer. Check the upstream gateway.`,true);
  report('Gateway','pass',`Reply from ${gateway} · QoS profile: ${c.qos}.`);
  const interference = c.nearby && c.band === '2.4' && Math.abs(c.channel - 6) < 5;
  report('RF',interference?'warn':'pass',interference ? 'Neighboring AP on channel 6 shares or overlaps this channel. Connectivity works, but contention or interference can reduce throughput.' : 'No overlapping channel detected in this practice topology.');
  const success = c.vlan === scenario.target && c.forwarding === scenario.forwarding && (!scenario.cleanRf || !interference) && c.security === (scenario.config.security ?? 'wpa2');
  report('Lab objective',success?'pass':'warn',success ? 'Scenario complete.' : `Connectivity works. Verify the requested security, VLAN ${scenario.target}, forwarding mode and RF settings.`);
  return { events, connected:true, success, lease };
}
