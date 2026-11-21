const ports = count => '<span></span>'.repeat(count);

function deviceStatus(label) {
  return `<div class="device-status"><b class="device-label">${label}</b>
  <div class="device-leds"><span></span><span></span><span></span></div></div>`;
}

function portBank(count, label, variant = '') {
  return `<div class="port-bank"><div class="device-ports ${variant}">${ports(count)}</div><span class="device-label">${label}</span></div>`;
}

function switchUnit(unit) {
  return `<div class="rack-device">
    <div class="device-face">
      ${deviceStatus(`SW · ${unit}`)}
      ${portBank(12, '01–12', 'device-ports-dense')}
      ${portBank(12, '13–24', 'device-ports-dense')}
      ${portBank(2, 'UPLINK', 'device-ports-fiber')}
    </div>
  </div>`;
}

export function rackHero() {
  return `<section class="hero" aria-labelledby="hero-title">
<div class="rack-stage">
  <div class="rack-backdrop" aria-hidden="true"></div>
  <div class="rack-scene" role="img" aria-label="Futuristic rack with a router, a two-switch stack, and a firewall">
    <div class="rack-shadow"></div>
    <div class="rack-side"></div>
    <div class="rack-roof"></div>
    <div class="rack-cabinet">
      <div class="rack-interior"></div>
      <div class="rack-bay rack-bay-router"></div>
      <div class="rack-bay rack-bay-switches"></div>
      <div class="rack-bay rack-bay-firewall"></div>
      <div class="rack-rail rack-rail-left"></div>
      <div class="rack-rail rack-rail-right"></div>
      <div class="rack-trim rack-trim-top"></div>
      <div class="rack-trim rack-trim-bottom"></div>
    </div>
    <div class="rack-module rack-router" data-rack-module>
      <div class="rack-device"><div class="device-face">
        ${deviceStatus('RTR · 01')}
        <div class="device-vents"></div>
        ${portBank(1, 'CONSOLE', 'device-console-port')}
        ${portBank(4, 'LAN / WAN')}
        ${portBank(2, 'SFP', 'device-ports-fiber')}
      </div></div>
    </div>
    <div class="rack-module rack-switches" data-rack-module>
      ${switchUnit('01')}${switchUnit('02')}
    </div>
    <div class="rack-module rack-firewall" data-rack-module>
      <div class="rack-device"><div class="device-face">
        ${deviceStatus('FW · 01')}
        <div class="device-vents"></div>
        ${portBank(2, 'MGMT / HA', 'device-console-port')}
        ${portBank(4, 'DATA')}
      </div></div>
    </div>
  </div>
  <h1 class="rack-title" id="hero-title" aria-label="Netra"><span aria-hidden="true"><i>N</i><i>e</i><i>t</i><i>r</i><i>a</i></span></h1>
  <div class="rack-words" aria-hidden="true">
    <span data-rack-word>Learn</span>
    <span data-rack-word>Simulate</span>
    <span data-rack-word>Master</span>
  </div>
</div>
</section>`;
}
