const $ = id => document.getElementById(id);
const node = (tag,text,className) => {
  const element=document.createElement(tag);
  if (text!==undefined) element.textContent=text;
  if (className) element.className=className;
  return element;
};
function button(text,onClick,className='ccna-control') {
  const element=node('button',text,className);
  element.type='button';
  element.addEventListener('click',onClick);
  return element;
}
function anchor(text,href,className='ccna-control') {
  const element=node('a',text,className);
  element.href=href;
  return element;
}
const iosMode = mode => ({user:'User EXEC',exec:'Privileged EXEC',global:'Global configuration',host:'Host shell'})[mode]??mode;

export function mountPractice({tracks,openSession,source,renderCoverage,onWireless,guidedPath,deepLinks=false}) {
  const input=$('lab-input');
  const output=$('lab-output');
  const search=$('ccna-search');
  const domains=$('ccna-domains');
  const workspace=search.closest('[data-practice]');
  const guided=workspace.dataset.practice==='guided';
  const nav=[...workspace.querySelectorAll('[data-view]')];
  const panelNodes=[...workspace.querySelectorAll('[data-panel]')];
  const trackButtons=[...workspace.querySelectorAll('[data-track]')];
  const pageSize=24;
  const visibleCards={reference:0,concepts:0};
  const answers=new Map();
  const domainsByID=new Map();
  let domain=0;
  let view='labs';
  let activeTrack;
  let current;
  let session;
  let device;
  let transcript;
  let history;
  let historyPosition;

  const labObjectives = lab => activeTrack.labObjectives?.(lab)??String(lab.objectives??'').split(/\s*·\s*/);
  const labDomains = lab => activeTrack.labDomains?.(lab)??[lab.domain];
  const domainNames = list => list.map(id=>domainsByID.get(id)?.title).filter(Boolean).join(' · ');
  const selectedDomain = lab => !domain||labDomains(lab).includes(domain);

  function matches(...values) {
    const words=search.value.trim().toLowerCase().split(/\s+/);
    if (!words[0]) return true;
    const content=values.join(' ').toLowerCase();
    return words.every(word=>content.includes(word));
  }

  function filterList() {
    const filtered=activeTrack.labs.filter(lab=>selectedDomain(lab)&&matches(lab.title,labObjectives(lab).join(' '),lab.task,domainNames(labDomains(lab)),
      ...lab.steps.flatMap(step=>Array.isArray(step)?step.slice(1,3):[step.command,step.explanation])));
    const items=filtered.map(lab=>{
      const item=button(lab.title,()=>{
        selectLab(lab);
        updateLocation();
      },'ccna-lab-link');
      item.append(node('small',domainNames(labDomains(lab))));
      item.setAttribute('aria-pressed',String(lab.id===current.id));
      return item;
    });
    $('ccna-lab-list').replaceChildren(...(items.length?items:[node('p','No matching labs.')]));
  }

  function showPrompt() {
    $('lab-prompt').textContent=session.prompt(device);
    for (const tab of $('lab-devices').children) tab.setAttribute('aria-pressed',String(tab.textContent===device));
  }

  function queueNext(focus=false) {
    const next=session.steps[session.cursor];
    if (!next) {showPrompt();return;}
    device=next.device;
    showPrompt();
    input.value=next.command;
    if (focus) input.focus();
  }

  const lessonUrl = (path,lab,index=0,viewName='labs') => {
    const query=new URLSearchParams({track:activeTrack.id,lab:lab.id});
    if(index)query.set('step',String(index));
    return path+'?'+query+'#'+viewName;
  };

  function renderGuide() {
    const step=session.steps[session.cursor];
    $('lab-progress').textContent=step?'Step '+(session.cursor+1)+' of '+session.steps.length+' · '+step.device:'Lab walkthrough complete';
    $('lab-explanation').textContent=step?.explanation??'Keep experimenting with the supported commands, or reset to start again.';
    $('lab-next').textContent=step?.command??'';
    $('lab-next').hidden=!step;
    $('lab-queue').disabled=!step;
    const link=$('lab-open');
    link.hidden=!guidedPath||guided;
    if (!link.hidden)link.href=lessonUrl(guidedPath,current,session.cursor);
    for (const [index,item] of [...$('lab-steps').children].entries()) {
      item.classList.toggle('done',index<session.cursor);
      if (index===session.cursor) item.setAttribute('aria-current','step');
      else item.removeAttribute('aria-current');
    }
  }

  function selectLab(lab,startAt=0) {
    current=lab;
    session=openSession(lab,startAt);
    device=lab.devices[0];
    input.value='';
    transcript=[session.help?'Netra guided CLI. Press Enter to run the loaded command. Use ? for help or Tab to complete a keyword.':
      'Netra practice console. Press Enter to run the loaded command, or type ? for available commands.'];
    history=[];
    historyPosition=0;
    if(startAt) transcript.push('Prerequisite steps applied. The selected command is ready to run.');
    $('lab-title').textContent=lab.title;
    $('lab-task').textContent=lab.task;
    const pointers=source?.(lab)??lab.source;
    $('lab-objective').textContent=[labObjectives(lab).map(id=>id==='extra.wlan'?'Wireless supplement':id).join(' · '),pointers].filter(Boolean).join(' · ');
    $('lab-topology').replaceChildren(...lab.topology.map(label=>node('li',label)));
    $('lab-devices').replaceChildren(...lab.devices.map(name=>button(name,()=>{
      device=name;
      input.value='';
      showPrompt();
      input.focus({preventScroll:true});
    },'ccna-device')));
    $('lab-steps').replaceChildren(...session.steps.map(step=>{
      const item=node('li');
      item.append(node('b',step.device),node('code',step.command));
      return item;
    }));
    output.textContent=transcript.join('\n');
    output.scrollTop=0;
    queueNext();
    renderGuide();
    filterList();
  }

  function log(...lines) {
    transcript=[...transcript,...lines].slice(-250);
    output.textContent=transcript.join('\n');
    output.scrollTop=output.scrollHeight;
  }

  $('lab-form').addEventListener('submit',event=>{
    event.preventDefault();
    const command=input.value;
    if (!command.trim()) return;
    const previous=session.cursor;
    const prompt=session.prompt(device);
    const result=session.run(device,command);
    log(prompt+' '+command,...(result.output?[result.output]:[]));
    history.push(command);
    historyPosition=history.length;
    input.value='';
    showPrompt();
    if (previous!==session.cursor) {
      renderGuide();
      queueNext();
    }
    input.focus({preventScroll:true});
  });
  input.addEventListener('keydown',event=>{
    if (session.help&&input.selectionStart===input.value.length&&input.selectionEnd===input.value.length) {
      if (event.key==='?'&&input.value.split('"').length%2===1&&input.value.split("'").length%2===1) {
        event.preventDefault();
        const help=session.help(device,input.value);
        log(session.prompt(device)+' '+input.value+'?',help.text);
        return;
      }
      if (event.key==='Tab'&&!event.shiftKey) {
        const help=session.help(device,input.value);
        if (help.completed&&help.completed!==input.value) {
          event.preventDefault();
          input.value=help.completed;
          return;
        }
      }
    }
    if (!['ArrowUp','ArrowDown'].includes(event.key)||!history.length) return;
    event.preventDefault();
    historyPosition=Math.min(history.length,Math.max(0,historyPosition+(event.key==='ArrowUp'?-1:1)));
    input.value=history[historyPosition]??'';
    input.setSelectionRange(input.value.length,input.value.length);
  });
  $('lab-queue').addEventListener('click',()=>queueNext(true));
  $('lab-reset').addEventListener('click',()=>{
    selectLab(current);
    updateLocation();
    input.focus({preventScroll:true});
  });

  function paginate(panel,entries,renderCard,append) {
    const box=$('ccna-'+panel);
    const more=$(panel==='reference'?'reference-more':'concept-more');
    const start=append?visibleCards[panel]:0;
    const end=Math.min(entries.length,start+pageSize);
    const cards=entries.slice(start,end).map((entry,index)=>renderCard(entry,start+index));
    if(append)box.append(...cards);
    else box.replaceChildren(...cards);
    visibleCards[panel]=end;
    more.hidden=end>=entries.length;
    return end;
  }

  function openCommandLab(lab,index=0) {
    selectLab(lab,index);
    changeView('labs',true,index);
    input.focus();
  }

  function renderReference(append=false) {
    const query=search.value.trim().toLowerCase();
    const modeLabel=activeTrack.modeLabel??iosMode;
    const entries=activeTrack.commandReference.filter(({lab,command,explanation,device,mode})=>
      selectedDomain(lab)&&matches(lab.title,command,explanation,device,modeLabel(mode),labObjectives(lab).join(' ')));
    if(query)entries.sort((a,b)=>Number(b.command.toLowerCase().includes(query))-Number(a.command.toLowerCase().includes(query)));
    const visible=paginate('reference',entries,({lab,index,device:target,command,explanation,mode})=>{
      const card=node('article',undefined,'ccna-card');
      const title=node('h3');
      title.append(node('code',command));
      const preview=node('details');
      const example=node('pre');
      preview.append(node('summary','Example result'),example);
      preview.addEventListener('toggle',()=>{
        if(!preview.open||example.textContent)return;
        const demo=openSession(lab,index);
        const prompt=demo.prompt(target);
        const result=demo.run(target,command);
        example.textContent=prompt+' '+command+'\n'+(result.output||demo.prompt(target));
      });
      const actions=node('div',undefined,'practice-card-actions');
      actions.append(button('Try command',()=>openCommandLab(lab,index)));
      if(guidedPath&&!guided)actions.append(anchor('Open in LabSim',lessonUrl(guidedPath,lab,index)));
      card.append(node('p',target+' · '+lab.title+' · Step '+(index+1),'ccna-card-tag'),title,
        node('p',modeLabel(mode),'ccna-card-tag'),node('p',explanation),preview,actions);
      return card;
    },append);
    $('reference-count').textContent=entries.length?visible+' of '+entries.length+' examples · repeated commands show different lab states':'No matching examples.';
  }

  function renderConcepts(append=false) {
    const filtered=activeTrack.concepts.filter(([category,id,title,prompt,answer,alts,why])=>
      (!domain||domain===category)&&matches(id,title,prompt,answer,...alts,why)).sort((a,b)=>a[1].localeCompare(b[1],undefined,{numeric:true}));
    const visible=paginate('concepts',filtered,([category,id,title,prompt,answer,alts,why],index)=>{
      const card=node('article',undefined,'ccna-card');
      const feedback=node('p',undefined,'ccna-feedback');
      feedback.setAttribute('role','status');
      const choices=[...alts];
      choices.splice(index % (choices.length+1),0,answer);
      const options=node('div',undefined,'ccna-choices');
      const key=activeTrack.id+'|'+id+'|'+prompt;
      function showAnswer(choice) {
        for(const item of options.children)item.setAttribute('aria-pressed',String(item.textContent===choice));
        if(!choice)return;
        feedback.dataset.result=choice===answer?'correct':'try-again';
        feedback.textContent=(choice===answer?'Correct. ':'Answer: '+answer+'. ')+why;
      }
      options.append(...choices.map(choice=>button(choice,()=>{
        answers.set(key,choice);
        showAnswer(choice);
      })));
      showAnswer(answers.get(key));
      const topic=id.startsWith('extra.')?domainsByID.get(category)?.title:'Objective '+id+' · '+domainsByID.get(category)?.title;
      card.append(node('p',topic,'ccna-card-tag'),node('h3',title),node('p',prompt),options,feedback);
      return card;
    },append);
    $('concept-count').textContent=filtered.length?visible+' of '+filtered.length+' checks':'No matching concept checks.';
  }

  function setDomain(id) {
    domain=id;
    for (const selector of domains.querySelectorAll('button'))selector.setAttribute('aria-pressed',String(Number(selector.dataset.domain)===id));
  }

  function render() {
    if(view==='labs')filterList();
    if(view==='reference')renderReference();
    if(view==='concepts')renderConcepts();
    if(view==='coverage')renderCoverage?.({
      track:activeTrack,domain,matches,node,button,
      openLab:lab=>{search.value='';setDomain(0);openCommandLab(lab);},
      openConcept:(id,category)=>{search.value=id;setDomain(category);changeView('concepts');}
    });
  }

  function updateLocation(step=0) {
    const href=deepLinks?lessonUrl(location.pathname,current,step,view):'#'+view;
    if (href!==(deepLinks?location.pathname+location.search+location.hash:location.hash))window.history.pushState(null,'',href);
  }

  function changeView(next,updateHash=true,step=0) {
    view=nav.some(link=>link.dataset.view===next)?next:'labs';
    for(const link of nav){
      if(link.dataset.view===view)link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    for(const panel of panelNodes)panel.hidden=panel.dataset.panel!==view;
    search.disabled=view==='wlan';
    domains.hidden=view==='wlan';
    if(updateHash)updateLocation(step);
    render();
  }

  function switchTrack(track,labId,index=0) {
    activeTrack=track;
    domain=0;
    domainsByID.clear();
    for(const item of track.domains)domainsByID.set(item.id,item);
    for(const element of trackButtons)element.setAttribute('aria-pressed',String(element.dataset.track===track.id));
    if($('ccnp-track-count'))$('ccnp-track-count').textContent=track.labs.length+' labs · '+track.commandCount+' commands'+(guided?'':' · '+track.concepts.length+' checks');
    domains.replaceChildren(...[{id:0,title:'All domains'},...track.domains].map(item=>{
      const filter=button(item.title,()=>{setDomain(item.id);render();},'ccna-filter');
      filter.setAttribute('aria-pressed',String(!item.id));
      filter.dataset.domain=item.id;
      if(item.weight)filter.title=item.weight+'% of the exam blueprint';
      return filter;
    }));
    const lab=track.labs.find(item=>item.id===labId)??track.labs.find(item=>item.id===track.initial)??track.labs[0];
    selectLab(lab,Math.min(Math.max(Number.isSafeInteger(index)?index:0,0),lab.steps.length));
  }

  function restoreLocation() {
    const query=new URLSearchParams(location.search);
    const requested=tracks.find(track=>track.id===query.get('track'))??tracks[0];
    switchTrack(requested,deepLinks?query.get('lab'):null,deepLinks?Number(query.get('step')):0);
    changeView(location.hash.slice(1),false);
  }

  $('reference-more').addEventListener('click',()=>renderReference(true));
  $('concept-more')?.addEventListener('click',()=>renderConcepts(true));
  for(const link of nav)link.addEventListener('click',event=>{event.preventDefault();changeView(link.dataset.view);});
  for(const control of trackButtons)control.addEventListener('click',()=>{
    if(activeTrack.id===control.dataset.track)return;
    search.value='';
    switchTrack(tracks.find(track=>track.id===control.dataset.track));
    updateLocation();
    render();
  });
  window.addEventListener('popstate',()=>{
    if(deepLinks)restoreLocation();
    else changeView(location.hash.slice(1),false);
  });
  search.addEventListener('input',render);
  restoreLocation();
  onWireless?.(()=>{
    const lab=activeTrack.labs.find(item=>item.id==='wireless-troubleshooting');
    search.value='';
    setDomain(2);
    openCommandLab(lab);
  });
}
