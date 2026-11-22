import { mountPractice } from '../practice/workspace.mjs';
import { tracks, sources, portableChapters } from './catalog.mjs';
import { openCCNPStep } from './session.mjs';

function coverage({track,domain,matches,node,button,openLab,openConcept}) {
  const list=document.getElementById('ccnp-coverage');
  if(!list)return;
  const domains=track.domains.filter(item=>!domain||item.id===domain);
  const groups=[];
  for(const {id,title,weight} of domains){
    const objectives=track.concepts.filter(([category,key,label,prompt])=>category===id&&matches(key,label,prompt,title));
    if(!objectives.length)continue;
    const group=node('section',undefined,'ccnp-coverage-group');
    const heading=node('div',undefined,'ccnp-coverage-title');
    heading.append(node('h3',title),node('span',weight?weight+'% of exam':'Supplemental practice'));
    const rows=node('ul',undefined,'ccnp-coverage-list');
    for(const [category,key,label] of objectives) {
      const item=node('li');
      const name=node('div');
      if(!key.startsWith('extra.'))name.append(node('span',key,'ccnp-objective'));
      name.append(node('b',label));
      const actions=node('div',undefined,'practice-card-actions');
      const relevant=track.labs.filter(lab=>lab.topics[track.id].includes(key));
      if(relevant.length) actions.append(button('Open lab',()=>openLab(relevant[0])));
      actions.append(button('Concept check',()=>openConcept(key,category)));
      item.append(name,actions);
      rows.append(item);
    }
    group.append(heading,rows);
    groups.push(group);
  }
  list.replaceChildren(...(groups.length?groups:[node('p','No matching objectives.')]));

  const book=document.getElementById('ccnp-book');
  book.replaceChildren(...portableChapters.map((title,index)=>{
    const found=track.labs.filter(lab=>lab.portable.includes(index+1));
    const row=node('div',undefined,'ccnp-book-row');
    row.append(node('h3','Chapter '+(index+1)+' · '+title));
    if(found.length){
      const links=node('div',undefined,'practice-card-actions');
      links.append(...found.map(lab=>button(lab.title,()=>openLab(lab))));
      row.append(links);
    }else row.append(node('p','Use the '+(track.id==='enarsi'?'ENCOR':'ENARSI')+' tab to find labs for this chapter.'));
    return row;
  }));
}

mountPractice({
  tracks,
  openSession:openCCNPStep,
  source:sources,
  guidedPath:'/labsim/ccnp/',
  renderCoverage:coverage,
  deepLinks:true
});
