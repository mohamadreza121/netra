const securityOptions = '<option value="wpa2">WPA2-Personal (AES)</option><option value="enterprise">WPA2-Enterprise (802.1X)</option><option value="wpa3">WPA3-Personal (SAE)</option><option value="open">Open</option>';

export function wirelessPractice() {
  return `<section data-panel="wlan" hidden>
  <div class="ccna-panel-heading"><h2>Wireless controller lab</h2><p>Run a client connection test and trace the path from AP power and CAPWAP through authentication, VLAN forwarding, DHCP, and the gateway.</p></div>
  <div class="wlan-scenarios ccna-card">
    <div><label for="wlan-scenario">Scenario</label><select id="wlan-scenario"></select></div>
    <p id="wlan-brief"></p>
    <button type="button" id="wlan-reset" class="ccna-control">Reset scenario</button>
  </div>
  <div class="wlan-workbench">
    <form id="wlan-form" class="ccna-card wlan-form">
      <h3>WLC-01 and infrastructure</h3>
      <fieldset><legend>WLAN profile</legend>
        <label>SSID<input name="ssid" maxlength="32" required></label>
        <label>Security<select name="security">${securityOptions}</select></label>
        <label data-wlan-psk>Lab passphrase<input name="key" type="password" autocomplete="off" maxlength="63" placeholder="8–63 characters"></label>
        <label class="wlan-check"><input name="enabled" type="checkbox"> Enable WLAN</label>
      </fieldset>
      <fieldset><legend>Policy profile and AP policy tag</legend>
        <label>Client VLAN<select name="vlan"><option value="10">10 · Staff</option><option value="20">20 · Guest</option><option value="99">99 · Management</option></select></label>
        <label>Data forwarding<select name="forwarding"><option value="central">Central switching at WLC</option><option value="local">Local switching at AP</option></select></label>
        <label>QoS profile<select name="qos"><option>Best effort</option><option>Voice</option><option>Background</option></select></label>
        <label class="wlan-check"><input name="policyEnabled" type="checkbox"> Enable policy profile</label>
        <label class="wlan-check"><input name="tag" type="checkbox"> Map WLAN to policy on AP-01</label>
      </fieldset>
      <details class="wlan-advanced"><summary>AP, switchports, DHCP and RF</summary>
        <fieldset><legend>AP and uplinks</legend>
          <label>AP site mode<select name="apMode"><option value="local">Local</option><option value="flex">FlexConnect</option></select></label>
          <label>AP switchport<select name="apPort"><option value="access">Access</option><option value="trunk">802.1Q trunk</option></select></label>
          <label>AP access / native VLAN<select name="apNative"><option value="1">1</option><option value="10">10</option><option value="20">20</option><option value="99">99 · AP management</option></select></label>
          <label>AP trunk allowed VLANs<input name="apVlans" placeholder="20,99"></label>
          <label>WLC trunk allowed VLANs<input name="wlcVlans" placeholder="10,20,99"></label>
          <label>Flex profile VLANs<input name="flexVlans" placeholder="20"></label>
          <label class="wlan-check"><input name="poe" type="checkbox"> AP PoE available</label>
          <label class="wlan-check"><input name="controllerReachable" type="checkbox"> Controller reachable from AP</label>
        </fieldset>
        <fieldset><legend>Network services</legend>
          <label>VLANs with DHCP scopes<input name="scopes" placeholder="10,20"></label>
          <label>VLANs with reachable gateways<input name="gateways" placeholder="10,20"></label>
          <label class="wlan-check"><input name="radius" type="checkbox"> RADIUS service reachable</label>
        </fieldset>
        <fieldset><legend>Radio at 20 MHz</legend>
          <label>Radio band<select name="band"><option value="2.4">2.4 GHz</option><option value="5">5 GHz</option></select></label>
          <label>Channel<select name="channel"></select></label>
          <label class="wlan-check"><input name="nearby" type="checkbox"> Neighbor AP on 2.4 GHz channel 6</label>
        </fieldset>
      </details>
      <button type="submit" class="ccna-control">Apply controller and infrastructure</button>
      <p id="wlan-status" role="status"></p>
    </form>
    <div class="wlan-test">
      <form id="wlan-client" class="ccna-card wlan-form">
        <h3>Client station</h3>
        <div class="wlan-pair">
          <label>Client SSID<input name="ssid" maxlength="32" required></label>
          <label>Client radio<select name="band"><option value="dual">Dual-band</option><option value="2.4">2.4 GHz only</option><option value="5">5 GHz only</option></select></label>
          <label>Client security<select name="security">${securityOptions}</select></label>
          <label data-wlan-psk>Client passphrase<input name="key" type="password" autocomplete="off" maxlength="63"></label>
          <label data-wlan-eap>Lab identity<input name="username" autocomplete="off"></label>
          <label data-wlan-eap>Lab identity password<input name="password" type="password" autocomplete="off"></label>
        </div>
        <div class="wlan-actions"><button type="submit" class="ccna-control">Test client connection</button><button type="button" id="wlan-cli" class="ccna-control">Open wireless CLI lab</button></div>
      </form>
      <article class="ccna-card wlan-diagnostics">
        <div><h3>Connection trace</h3><p id="wlan-detail" role="status"></p></div>
        <ol id="wlan-output" aria-label="Wireless connection stages"></ol>
      </article>
    </div>
  </div>
  <p class="wlan-source">The controller model follows the <a href="https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/213911-understand-catalyst-9800-wireless-contro.html">Catalyst 9800 profile and tag model</a>. APs, traffic and credentials are local to this simulation.</p>
</section>`;
}
