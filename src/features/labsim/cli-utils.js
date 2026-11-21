export const reply=(text='',path=[])=>({text,path});
export const invalid=message=>reply('% '+message);
export const integer=(value,min,max)=>/^\d+$/.test(value??'')&&Number(value)>=min&&Number(value)<=max;
export const keyName=value=>/^[a-z0-9][a-z0-9_.-]{0,47}$/i.test(value??'')&&!['constructor','prototype'].includes(value.toLowerCase());
export const own=(object,key)=>object&&Object.hasOwn(object,key)?object[key]:undefined;

export function enter(session, mode, current, nested=false) {
  if (nested) {
    session.parents??=[];
    session.parents.push({mode:session.mode,current:session.current});
  }
  session.mode=mode;
  session.current=current;
  return reply();
}

export function leave(session, end) {
  const parent=end?null:session.parents?.pop();
  if (parent) Object.assign(session,parent);
  else {
    session.mode=end||session.mode==='global'?'exec':'global';
    session.current=null;
    session.parents=[];
  }
  return reply();
}
