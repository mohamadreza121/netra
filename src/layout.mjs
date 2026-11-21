const routes = [
  ['', 'Home'], ['ccna', 'CCNA Practice'], ['ccnp', 'CCNP Practice'], ['labsim', 'LabSim']
];

const logo = '<span class="brand-icon" aria-hidden="true">✳</span><span>netra<span class="brand-period">.</span></span>';

const links = (route) => routes.map(([path, label]) =>
  `<a href="/${path ? path + '/' : ''}" ${path === route ? 'aria-current="page"' : ''}>${label}</a>`
).join('');

export function layout({route, title, content, intro}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#111c19">
<meta name="description" content="Netra is a browser-based workspace for CCNA and CCNP practice and Cisco configuration labs.">
<title>${route ? title + ' · Netra' : 'Netra — Learn. Simulate. Master.'}</title>
<link rel="icon" href="/assets/netra.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles/main.css">
${intro ? '<link rel="stylesheet" href="/styles/rack.css"><script type="module" src="/motion.js"></script>' : ''}
</head>
<body class="route-${route || 'home'}">
<a class="skip" href="#main">${intro ? 'Skip animation' : 'Skip to content'}</a>
<header class="site-header" data-nav-theme="${route || 'home'}"><div class="nav-wrap">
<a class="brand" href="/" aria-label="Netra home">${logo}</a>
<nav aria-label="Main navigation">${links(route)}</nav>
<a class="header-cta" href="${route === 'labsim' ? '/' : '/labsim/'}">${route === 'labsim' ? 'Back to home' : '<span aria-hidden="true">›_</span> Open LabSim'}</a>
</div></header>
${intro || ''}
<main id="main" tabindex="-1">${content}</main>
<footer class="site-footer"><div class="frame footer-grid">
<div><a class="brand" href="/" aria-label="Netra home">${logo}</a><p>Learn. Simulate. Master.</p></div>
<nav aria-label="Footer navigation">${links(route)}</nav>
<a class="repo-link" href="https://github.com/mohamadreza121/netra">GitHub</a>
</div><div class="frame footer-base"><span>© Netra</span><span>Independent networking education project.</span></div></footer>
</body>
</html>`;
}
