import { practiceUrl } from './practice-url.js';

const pageSize=24;
const node=(tag,text,className)=>{
  const el=document.createElement(tag);
  if(text!==undefined)el.textContent=text;
  if(className)el.className=className;
  return el;
};
const labels={ccna:'CCNA',encor:'ENCOR',enarsi:'ENARSI'};

export function mountCommandIndex({loadExample}) {
  const panel=document.getElementById('ios-commands');
  const search=panel.querySelector('#ios-command-query');
  const track=panel.querySelector('#ios-command-track');
  const availability=panel.querySelector('#ios-command-availability');
  const list=panel.querySelector('#ios-command-results');
  const status=panel.querySelector('#ios-command-count');
  const more=panel.querySelector('#ios-command-more');
  let examples;
  let visible=pageSize;

  function render(reset=true) {
    if(!examples)return;
    if(reset)visible=pageSize;
    const query=search.value.trim().toLowerCase();
    const words=query?query.split(/\s+/):[];
    const rows=examples.filter(example=>(!track.value||example.tracks.includes(track.value))&&
      (!availability.value||example.labSim===(availability.value==='live'))&&words.every(word=>example.text.includes(word)));
    if(query)rows.sort((a,b)=>Number(b.key===query)-Number(a.key===query)||Number(b.key.includes(query))-Number(a.key.includes(query))||
      Number(b.labSim)-Number(a.labSim));
    status.textContent=rows.length?rows.length.toLocaleString()+' examples · '+rows.filter(row=>row.labSim).length.toLocaleString()+
      ' checked in LabSim · '+Math.min(rows.length,visible)+' shown':'No matching commands.';
    list.replaceChildren(...rows.slice(0,visible).map(example=>{
      const row=node('li',undefined,'ios-command-row');
      const info=node('div',undefined,'ios-command-info');
      info.append(node('code',example.command),node('p',example.tracks.map(id=>labels[id]).join(' / ')+' · '+example.title+' · '+example.device+' · '+example.mode),
        node('p',example.explanation,'ios-command-explanation'));
      const actions=node('div',undefined,'ios-command-actions');
      const practice=node('a','Open practice','sim-button');
      practice.href=practiceUrl(example,track.value);
      actions.append(practice);
      if(example.labSim){
        const tryButton=node('button','Use in LabSim','sim-button sim-accent');
        tryButton.type='button';
        tryButton.addEventListener('click',()=>loadExample(example));
        actions.append(tryButton);
      }
      row.append(info,actions);
      return row;
    }));
    more.hidden=rows.length<=visible;
  }

  async function openIndex() {
    if(examples)return;
    status.textContent='Loading the command index…';
    try{
      const response=await fetch('/features/labsim/course-commands.json');
      if(!response.ok)throw new Error('Command index request failed.');
      examples=(await response.json()).map(example=>({...example,key:example.command.toLowerCase(),
        text:[example.command,example.explanation,example.mode,example.title,example.device,example.type].join(' ').toLowerCase()}));
      render();
    }catch{
      status.textContent='The command index could not load. Close and reopen it to retry.';
    }
  }
  let loading;
  const once=()=>{loading??=openIndex().finally(()=>{loading=null;});};
  panel.addEventListener('toggle',()=>{if(panel.open)once();});
  if(location.hash==='#ios-commands'){panel.open=true;once();}
  for(const field of [search,track,availability])field.addEventListener(field===search?'input':'change',()=>render());
  more.addEventListener('click',()=>{visible+=pageSize;render(false);});
}
