import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labs } from '../src/features/ccna/catalog.mjs';
import { makeSession } from '../src/features/ccna/engine.mjs';

function runLab(id) {
  const model = makeSession(labs.find(lab => lab.id === id));
  return model.steps.map(step => model.run(step.device, step.command).output).join('\n');
}

for (const lab of labs) {
  test(`each command advances the ${lab.id} walkthrough`, () => {
    const model = makeSession(lab);
    for (const step of model.steps) {
      const result = model.run(step.device, step.command);
      assert.equal(result.ok, true, step.command);
      assert.equal(model.cursor, step.index + 1, step.command);
    }
  });
}

test('OSPF adjacency changes with network type and link state', () => {
  const output = runLab('ospf');
  assert.match(output, /FULL\/BDR[\s\S]+FULL\/-[\s\S]+No OSPF neighbors[\s\S]+FULL\/-/);
});

test('ACL counters change and DNS stops working once its rule is removed', () => {
  const output = runLab('acl');
  assert.match(output, /20 permit udp[^\n]*\(1 matches\)/);
  assert.match(output, /30 deny ip[^\n]*\(1 matches\)/);
  assert.match(output, /Packet denied and logged by EDGE-IN\.$/);
});

test('PAT shares the global IP and allocates distinct transport ports', () => {
  const output = runLab('nat');
  assert.match(output, /198\.51\.100\.10:40000[\s\S]+198\.51\.100\.10:40001/);
});

test('withdrawing a primary activates the floating route', () => {
  assert.match(runLab('ipv4-static'), /10\.20\.0\.0\/16 \[200\/0\] via 192\.0\.2\.3/);
});

test('configuration commands reject the wrong CLI mode', () => {
  const model = makeSession(labs.find(lab => lab.id === 'device-setup'));
  assert.equal(model.run('R1','ip address 192.168.10.1 255.255.255.0').ok,false);
  assert.equal(model.cursor,0);
  assert.equal(model.state.address,undefined);
});

test('REST resource stops being readable after DELETE', () => {
  assert.match(runLab('rest-api'), /201 Created[\s\S]+"managed": false[\s\S]+204 No Content\nHTTP\/1\.1 404 Not Found$/);
});
