const ports = count => '<span></span>'.repeat(count);

function switchUnit() {
  return `<div class="rack-device">
    <div class="device-face">
      <div class="device-leds"><span></span><span></span><span></span></div>
      <div class="device-ports device-ports-dense">${ports(24)}</div>
      <div class="device-ports device-ports-fiber">${ports(2)}</div>
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
        <div class="device-leds"><span></span><span></span><span></span></div>
        <div class="device-vents"></div>
        <div class="device-ports">${ports(4)}</div>
        <div class="device-ports device-ports-fiber">${ports(2)}</div>
      </div></div>
    </div>
    <div class="rack-module rack-switches" data-rack-module>
      ${switchUnit()}${switchUnit()}
    </div>
    <div class="rack-module rack-firewall" data-rack-module>
      <div class="rack-device"><div class="device-face">
        <div class="device-leds"><span></span><span></span><span></span></div>
        <div class="device-vents"></div>
        <div class="device-ports">${ports(6)}</div>
      </div></div>
    </div>
  </div>
  <h1 class="rack-title" id="hero-title" aria-label="Netra"><span aria-hidden="true"><i>N</i><i>e</i><i>t</i><i>r</i><i>a</i></span></h1>
  <div class="rack-words" aria-hidden="true">
    <span data-rack-word>Learn</span>
    <span data-rack-word>Simulate</span>
    <span data-rack-word>Master</span>
  </div>
  <a class="skip" href="#main">Skip animation</a>
</div>
</section>`;
}
