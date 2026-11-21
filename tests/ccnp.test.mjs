import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labs, tracks, portableChapters, commandCount } from '../src/features/ccnp/catalog.mjs';
import { makeCCNPSession, openCCNPStep } from '../src/features/ccnp/session.mjs';
import { ccnpPractice } from '../src/pages/ccnp.mjs';
import { layout } from '../src/layout.mjs';

const objectives = {
  encor: '1.1.a 1.1.b 1.2.a 1.2.b 1.3.a 1.3.b 1.4 2.1.a 2.1.b 2.1.c 2.2.a 2.2.b 2.3.a 2.3.b 3.1.a 3.1.b 3.1.c 3.2.a 3.2.b 3.2.c 3.2.d 3.3.a 3.3.b 3.3.c 3.3.d 4.1 4.2 4.3 4.4 4.5 4.6 5.1.a 5.1.b 5.2.a 5.2.b 5.3 5.4.a 5.4.b 5.4.c 5.4.d 6.1 6.2 6.3 6.4 6.5 6.6 6.7',
  enarsi: '1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9.a 1.9.b 1.9.c 1.9.d 1.9.e 1.9.f 1.10.a 1.10.b 1.10.c.i 1.10.c.ii 1.10.c.iii 1.10.c.iv 1.10.d 1.11.a 1.11.b 1.11.c 1.11.d 1.11.e 2.1 2.2 2.3.a 2.3.b 2.3.c 2.3.d 2.3.e 3.1 3.2.a 3.2.b 3.2.c 3.3 3.4 4.1.a 4.1.b 4.1.c 4.2 4.3 4.4 4.5 4.6 4.7'
};

test('every published ENCOR and ENARSI leaf objective has a concept check',()=>{
  for(const track of tracks) {
    const keys=track.concepts.map(check=>check[1]);
    assert.equal(new Set(keys).size,keys.length);
    assert.deepEqual(keys.filter(key=>!key.startsWith('extra.')).sort(),objectives[track.id].split(' ').sort());
    assert.equal(track.domains.reduce((sum,item)=>sum+item.weight,0),100);
    for(const lab of track.labs)for(const key of lab.topics[track.id])assert.ok(keys.includes(key),lab.id+' unknown objective '+key);
  }
});

test('all 13 Portable Command Guide chapters have executable examples',()=>{
  assert.deepEqual([...new Set(labs.flatMap(lab=>lab.portable))].sort((a,b)=>a-b),portableChapters.map((_,i)=>i+1));
  assert.equal(new Set(labs.map(lab=>lab.id)).size,labs.length);
  assert.equal(commandCount,new Set(labs.flatMap(lab=>lab.steps.map(step=>step.command.toLowerCase()))).size);
});

for(const lab of labs)test('CCNP walkthrough: '+lab.id,()=>{
  const session=makeCCNPSession(lab);
  for(const step of lab.steps) {
    const result=session.run(step.device,step.command);
    assert.ok(result.ok,step.command+' → '+result.output);
    assert.equal(session.cursor,step.index+1,'did not advance for '+step.command);
    assert.ok(step.explanation.trim(),'missing explanation for '+step.command);
  }
});

test('each command reference deep link applies prerequisites and produces the same result',()=>{
  const replayed=new Map(labs.map(lab=>{
    const session=makeCCNPSession(lab);
    const outcomes=lab.steps.map(step=>({
      prompt:session.prompt(step.device),
      result:session.run(step.device,step.command)
    }));
    return [lab.id,outcomes];
  }));
  const checked=new Set();
  for(const track of tracks)for(const {lab,index,device,command} of track.commandReference) {
    const key=lab.id+':'+index;
    if(checked.has(key))continue;
    checked.add(key);
    const expected=replayed.get(lab.id)[index];
    const session=openCCNPStep(lab,index);
    assert.equal(session.prompt(device),expected.prompt,key);
    assert.deepEqual(session.run(device,command),expected.result,key);
    assert.equal(session.cursor,index+1,key);
  }
});

test('CCNP CLI resolves IOS prefixes, checks ambiguity, enforces mode and preserves case in quoted arguments',()=>{
  const lab=labs.find(lab=>lab.id==='ebgp-dual-stack');
  const session=makeCCNPSession(lab);
  assert.match(session.run('R1','router bgp 65024').output,/CLI mode/);
  assert.equal(session.run('R1','en').ok,true);
  assert.equal(session.run('R1','sh ip bgp sum').ok,true);
  assert.equal(session.help('R1','sh ip bgp sum').completed,'sh ip bgp summary ');
  assert.match(session.run('R1','show bgp ?').output,/ipv4[\s\S]*ipv6/);
  assert.match(session.run('R1','show bgp i').output,/Ambiguous/);
  assert.equal(session.run('R1','conf t').ok,true);
  assert.equal(session.run('R1','rou bgp 65024').ok,true);
  assert.match(session.run('R1','addr-f ipv4 uni').output,/Command unavailable/);
  assert.ok(session.run('R1','add ipv4 uni').ok);
  assert.equal(session.prompt('R1'),'R1(config-router-af)#');
  assert.ok(session.run('R1','exit-address-family').ok);
  assert.equal(session.prompt('R1'),'R1(config-router)#');

  const ospf=labs.find(lab=>lab.id==='ospf-multiarea');
  const port=ospf.steps.findIndex(step=>step.device==='R1'&&step.command==='interface GigabitEthernet0/0');
  const restored=openCCNPStep(ospf,port);
  assert.ok(restored.run('R1','int g0/0').ok);
  assert.equal(restored.prompt('R1'),'R1(config-if)#');

  const api=labs.find(lab=>lab.id==='netconf-restconf');
  const patch=api.steps.find(step=>step.command.includes('"Netra edge"'));
  assert.ok(patch);
  const apiSession=openCCNPStep(api,patch.index);
  assert.equal(apiSession.run(patch.device,patch.command.replace('Netra edge','netra edge')).ok,false);
  assert.match(apiSession.run(patch.device,patch.command).output,/204 No Content/);
  const read=api.steps[patch.index+1];
  assert.match(apiSession.run(read.device,read.command).output,/"description": "Netra edge"/);
});

test('guided cases show operational state changing after a fix or traffic sample',()=>{
  const cases=[
    ['ebgp-dual-stack','show ip bgp summary', /No IPv4 BGP adjacency/, /4200000042  1/],
    ['ospf-multiarea','show ip ospf neighbor', /No FULL neighbor/, /FULL\/-/],
    ['mst-region','show spanning-tree mst interface GigabitEthernet0/1', /Bound\(RSTP\)/, /internal/],
    ['dmvpn-phase3','show dmvpn', /NBMA Peers: 0/, /NBMA Peers: 2/],
    ['netflow-ipfix','show flow monitor EDGE-MONITOR cache', /zero entries/, /203\.0\.113\.8/],
    ['pbr-sla-failover','show ip route 0.0.0.0', /192\.0\.2\.66/, /192\.0\.2\.70/],
    ['copp-routing-management','show policy-map control-plane', /CONTROL-MGMT: 0 matched/, /CONTROL-MGMT: 1 matched/]
  ];
  for(const [id,command,before,after] of cases){
    const lab=labs.find(item=>item.id===id);
    const matching=lab.steps.filter(step=>step.command===command);
    assert.ok(matching.length>=2,id);
    for(const [step,pattern] of [[matching[0],before],[matching[1],after]]) {
      const session=openCCNPStep(lab,step.index);
      assert.match(session.run(step.device,command).output,pattern,id);
    }
  }
});

test('the CCNP Practice and LabSim guided routes load the same console module',()=>{
  const practice=layout({route:'ccnp',title:'CCNP Practice',content:ccnpPractice()});
  const guided=layout({route:'labsim/ccnp',title:'CCNP CLI Labs',content:ccnpPractice({guided:true})});
  for(const html of [practice,guided]) {
    assert.match(html,/\/features\/ccnp\/app\.mjs/);
    assert.match(html,/data-track="encor"/);
    assert.match(html,/data-track="enarsi"/);
  }
  assert.match(practice,/id="ccnp-coverage"/);
  assert.match(guided,/data-practice="guided"/);
  assert.match(guided,/<a href="\/labsim\/" aria-current="page">/);
  assert.doesNotMatch(guided,/\/features\/labsim\/app\.js/);
});
