export function practiceUrl(example,track) {
  const selected=example.tracks.includes(track)?track:example.tracks[0];
  const query=new URLSearchParams({track:selected,lab:example.lesson});
  if(example.index)query.set('step',String(example.index));
  return (selected==='ccna'?'/ccna/':'/labsim/ccnp/')+'?'+query+'#labs';
}
