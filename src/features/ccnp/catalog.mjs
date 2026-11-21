import { routing } from './routing.mjs';
import { infrastructure } from './infrastructure.mjs';
import { overlays } from './overlays.mjs';
import { security } from './security.mjs';
import { assurance } from './assurance.mjs';
import { automation } from './automation.mjs';
import { supplements } from './supplement.mjs';
import { encorConcepts, enarsiConcepts } from './concepts.mjs';
import { labelMode } from './lesson.mjs';

export const labs = [...routing,...infrastructure,...overlays,...security,...assurance,...automation,...supplements];

export const portableChapters = [
  'VLANs, trunks and EtherChannel','Spanning tree','Inter-VLAN routing','EIGRP','OSPF',
  'Redistribution and path control','BGP','IP services','Device management','Infrastructure security',
  'Network assurance','Wireless security and troubleshooting','Overlay tunnels and VRF'
];

const domains = pairs => pairs.map(([title,weight],index)=>({id:index+1,title,weight}));
const encorDomains = domains([
  ['Architecture',15],['Virtualization',10],['Infrastructure',30],['Network assurance',10],
  ['Security',20],['Automation and AI',15],['Wireless supplement',0]
]);
const enarsiDomains = domains([
  ['Layer 3 technologies',35],['VPN technologies',20],['Infrastructure security',20],['Infrastructure services',25]
]);

export function domainOf(objective) {
  return objective?.startsWith('extra.')?7:Number(objective?.split('.')[0]);
}

function makeTrack(id,exam,title,domains,concepts,initial,blueprint) {
  const included=labs.filter(lab=>lab.topics[id]?.length);
  const seen=new Set();
  const commandReference=included.flatMap(lab=>lab.steps.filter(step=>{
    if (!step.navigation) return true;
    const key=step.mode.level+' '+step.mode.path.join(' ')+' '+step.command.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(step=>({...step,lab})));
  return {
    id,exam,title,domains,concepts,initial,blueprint,labs:included,commandReference,
    commandCount:new Set(commandReference.map(entry=>entry.command.toLowerCase())).size,
    labDomains:lab=>[...new Set(lab.topics[id].map(domainOf))],
    labObjectives:lab=>lab.topics[id],
    modeLabel:labelMode
  };
}

export const tracks = [
  makeTrack('encor','350-401','ENCOR',encorDomains,encorConcepts,'ebgp-dual-stack','https://learningcontent.cisco.com/documents/marketing/exam-topics/350-401-ENCORE-v1.2.pdf'),
  makeTrack('enarsi','300-410','ENARSI',enarsiDomains,enarsiConcepts,'redistribution-tags','https://learningcontent.cisco.com/documents/marketing/exam-topics/300-410-ENARSI-v1.1-7-2025.pdf')
];

export const commandCount = new Set(labs.flatMap(lab=>lab.steps.map(step=>step.command.toLowerCase()))).size;
export const conceptCount = tracks.reduce((count,track)=>count+track.concepts.length,0);

export function sources(lab) {
  const format=chapters=>chapters.length>1?'chs. '+chapters.join(', '):'ch. '+chapters[0];
  return [lab.portable?.length?'Portable guide '+format(lab.portable):null,
    lab.guide?.length?'Official Cert Guide '+format(lab.guide):null].filter(Boolean).join(' · ');
}
