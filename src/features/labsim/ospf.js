import { ipv4, linkUp, networkAddress, segment } from './network.js';

export function ospfInterfaces(lab, device) {
  const process = device.ospf;
  if (!process) return [];
  return Object.entries(device.ports).flatMap(([port, setting]) => {
    if (!setting.address || !linkUp(lab, device, port)) return [];
    const active = setting.ospf?.process === process.id || process.networks.some(rule => {
      const fixed = ~ipv4(rule.wildcard);
      return (ipv4(setting.address) & fixed) === (ipv4(rule.address) & fixed);
    });
    if (!active) return [];
    return [{port, address:setting.address, prefix:setting.prefix,
      passive:process.passive[port] ?? process.passiveDefault ?? false,
      cost:setting.ospf?.cost ?? Math.max(1, Math.floor((process.reference ?? 100) * 1000 / (setting.bandwidth ?? 1000000))),
      hello:setting.ospf?.hello ?? 10, dead:setting.ospf?.dead ?? 40,
      priority:setting.ospf?.priority ?? 1, network:setting.ospf?.network ?? 'broadcast'}];
  });
}

export function routerId(device) {
  const addresses = ([, port]) => port.address;
  const highest = entries => entries.map(addresses).filter(Boolean).sort((a,b)=>ipv4(b)-ipv4(a))[0];
  const ports = Object.entries(device.ports);
  return device.ospf?.routerId ?? highest(ports.filter(([name])=>name.startsWith('Lo'))) ?? highest(ports);
}

export function ospfNeighbors(lab, device, interfaces) {
  const links = [];
  for (const local of interfaces.get(device.id) ?? []) {
    if (local.passive || local.port.startsWith('Lo')) continue;
    for (const reachable of segment(lab, device, local.port)) {
      const remote = interfaces.get(reachable.device.id)?.find(entry=>entry.port===reachable.port);
      if (!remote || remote.passive || local.network!==remote.network || local.hello!==remote.hello || local.dead!==remote.dead) continue;
      if (local.network==='broadcast' && local.priority===0 && remote.priority===0) continue;
      if (local.prefix!==remote.prefix || networkAddress(local.address,local.prefix)!==networkAddress(remote.address,remote.prefix)) continue;
      if (routerId(device)===routerId(reachable.device)) continue;
      links.push({device:reachable.device, local, remote});
    }
  }
  return links;
}

export const ospfSnapshot = lab => new Map(lab.devices.filter(device=>device.ospf).map(device=>[device.id,ospfInterfaces(lab,device)]));

export function ospfRoutes(lab, source, staticRoutes) {
  if (!source.ospf) return [];
  const interfaces = ospfSnapshot(lab);
  const best = new Map([[source.id, {device:source, metric:0}]]);
  const visited = new Set();
  const learned = [];
  while (true) {
    const current = [...best.values()].filter(row=>!visited.has(row.device.id)).sort((a,b)=>a.metric-b.metric)[0];
    if (!current) break;
    const device = current.device;
    visited.add(device.id);
    if (device!==source) {
      for (const entry of interfaces.get(device.id)) {
        learned.push({destination:networkAddress(entry.address,entry.prefix), prefix:entry.prefix, port:current.port,
          next:current.next, distance:110, metric:current.metric+entry.cost, protocol:'ospf'});
      }
      if (device.ospf.defaultRoute && (device.ospf.defaultRoute==='always' || staticRoutes(lab,device).some(r=>r.prefix===0))) {
        learned.push({destination:'0.0.0.0',prefix:0,port:current.port,next:current.next,distance:110,metric:current.metric+1,protocol:'ospf'});
      }
    }
    for (const {device:neighbor,local,remote} of ospfNeighbors(lab,device,interfaces)) {
      const metric=current.metric+local.cost;
      if (metric<(best.get(neighbor.id)?.metric ?? Infinity)) {
        best.set(neighbor.id,{device:neighbor,metric,port:current.port??local.port,next:current.next??remote.address});
      }
    }
  }
  return learned;
}
