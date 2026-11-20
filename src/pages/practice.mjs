export function practice(track) {
  const items = track.topics.map(([title, description, command]) =>
    `<article class="outline-topic"><h2>${title}</h2><p>${description}</p><code>${command}</code></article>`
  ).join('');
  return `<section class="interior-hero"><div class="frame"><p class="eyebrow">${track.title}</p><h1>${track.headline}</h1><p>${track.description}</p></div></section>
  <section class="outline"><div class="frame"><div class="outline-heading"><h2>Topic roadmap</h2><p>Planned short practices with a task, a hint, and a verification command.</p></div>
  <div class="outline-grid">${items}</div></div></section>`;
}
