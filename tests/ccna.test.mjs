import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labs, commandReference } from '../src/features/ccna/catalog.mjs';
import { makeSession, openAtStep } from '../src/features/ccna/engine.mjs';

import { concepts } from '../src/features/ccna/concepts.mjs';
import { wirelessConfig, wirelessScenarios, testWireless } from '../src/features/ccna/wireless.mjs';
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

test('each reference entry opens in its CLI context and reproduces the walkthrough result', () => {
  const walkthrough = new Map(labs.map(lab => {
    const session = makeSession(lab);
    const outputs = session.steps.map(step => ({
      prompt:session.prompt(step.device),
      result:session.run(step.device,step.command)
    }));
    return [lab.id,outputs];
  }));
  assert.equal(commandReference.length, labs.reduce((count,lab)=>count+lab.steps.length,0));
  for (const entry of commandReference) {
    const session = openAtStep(entry.lab,entry.index);
    const expected = walkthrough.get(entry.lab.id)[entry.index];
    assert.equal(session.prompt(entry.device),expected.prompt);
    assert.deepEqual(session.run(entry.device,entry.command),expected.result);
    assert.equal(session.cursor,entry.index+1);
  }
});

test('closed sequence of numbered v1.1 objectives has a concept check', () => {
  const covered = new Set();
  for (const [,id] of concepts) {
    const labels = [...id.matchAll(/(\d)\.(\d+)/g)];
    labels.forEach(([,domain,objective])=>covered.add(domain+'.'+objective));
    if (labels.length === 2 && id.includes('–') && labels[0][1] === labels[1][1]) {
      for (let i=Number(labels[0][2]);i<=Number(labels[1][2]);i++) covered.add(labels[0][1]+'.'+i);
    }
  }
  [13,9,5,9,10,7].forEach((count,index)=>{
    for(let objective=1;objective<=count;objective++)assert.ok(covered.has(`${index+1}.${objective}`),`Objective ${index+1}.${objective}`);
  });
});

const fixes = {
  campus: c=>Object.assign(c,{enabled:true,policyEnabled:true,tag:true,key:'NetraStaff26'}),
  psk: (c,client)=>{client.key=c.key;},
  branch: c=>{c.apVlans.push(20);},
  'central-trunk': c=>{c.wlcVlans.push(10);},
  'dhcp-scope': c=>{c.scopes.push(10);},
  rf: c=>{c.channel=11;},
  enterprise: c=>{c.radius=true;}
};
const firstFailure = {campus:'Discovery',psk:'Authentication',branch:'Forwarding','central-trunk':'Forwarding','dhcp-scope':'DHCP',rf:undefined,enterprise:'802.1X'};
for (const scenario of wirelessScenarios) {
  test(`${scenario.id}: wireless scenario can be diagnosed and repaired`, () => {
    const c = wirelessConfig(scenario);
    const client = {...scenario.client};
    const initial = testWireless(c,client,scenario);
    assert.equal(initial.success,false);
    assert.equal(initial.events.find(event=>event.state==='fail')?.stage,firstFailure[scenario.id]);
    fixes[scenario.id](c,client);
    const result = testWireless(c,client,scenario);
    assert.equal(result.success,true);
    assert.equal(result.lease,`192.168.${scenario.target}.21`);
  });
}

test('wireless CLI verifies profile and trunk changes with client state', () => {
  assert.match(runLab('wireless-setup'), /IPv4 Address: 192\.168\.10\.21[\s\S]+WLAN 10  Run/);
  assert.match(runLab('wireless-troubleshooting'), /VLAN 20 cannot leave[\s\S]+IP Learn[\s\S]+20,99[\s\S]+192\.168\.20\.21[\s\S]+WLAN 20  Run/);
});
