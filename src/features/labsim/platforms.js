export const deviceLimit = 10;
const gigabit = (count, offset = 0) => Array.from({length:count}, (_, index) => 'Gi0/'+(index+offset));
export const models = {
  router: { title:'Router', platform:'IOS XE-style enterprise edge', prefix:'R', ports:gigabit(4), icon:'router', ios:true },
  switch: { title:'Switch', platform:'Catalyst-style multilayer switch', prefix:'SW', ports:gigabit(24,1), icon:'workgroup-switch', ios:true },
  pc: { title:'PC', platform:'Dual-stack workstation', prefix:'PC', ports:['Eth0'], icon:'pc' },
  phone: { title:'IP phone', platform:'Cisco-style voice endpoint', prefix:'TEL', ports:['Eth0','Eth1'], icon:'ip-phone' },
  ap: { title:'Wi-Fi AP', platform:'Standalone or controller-managed AP', prefix:'AP', ports:['Eth0'], icon:'accesspoint' },
  wlc: { title:'Wireless controller', platform:'Catalyst 9800-style WLAN controller', prefix:'WLC', ports:['Gi0/0'], icon:'wlan-controller', ios:true },
  ise: { title:'ISE', platform:'Identity and policy services', prefix:'ISE', ports:['Eth0'], icon:'ise' },
  server: { title:'Server', platform:'Infrastructure and voice services', prefix:'SRV', ports:['Eth0'], icon:'server' }
};
export const capacity = Object.keys(models).length * deviceLimit;
export const isHost = device => device.type==='pc'||device.type==='phone';
export const isEndpoint = device => !models[device.type].ios || device.type==='wlc';
export const primaryPort = device => models[device.type].ports[0];
