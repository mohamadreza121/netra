const routes = [
  ['', 'Home'], ['ccna', 'CCNA Practice'], ['ccnp', 'CCNP Practice'], ['labsim', 'LabSim']
];

const logoPath = '/assets/netra.svg';
const logo = `<img class="brand-icon" src="${logoPath}" width="56" height="56" alt="">`;

const links = (route) => routes.map(([path, label]) =>
  `<a href="/${path ? path + '/' : ''}" ${path === route ? 'aria-current="page"' : ''}>${label}</a>`
).join('');

export function layout({route, title, content, intro}) {
  const guided = route === 'labsim/ccnp';
  const current = guided ? 'labsim' : route;
  const practice = guided || route === 'ccnp' ? 'ccnp' : route === 'ccna' ? 'ccna' : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#111c19">
<meta name="description" content="Netra is a browser-based workspace for CCNA and CCNP practice and Cisco configuration labs.">
<title>${route ? title + ' · Netra' : 'Netra — Learn. Simulate. Master.'}</title>
<link rel="icon" href="${logoPath}" type="image/svg+xml">
<link rel="stylesheet" href="/styles/main.css">
${intro ? '<link rel="stylesheet" href="/styles/rack.css"><script type="module" src="/motion.js"></script>' : ''}
${practice ? `<link rel="stylesheet" href="/styles/ccna.css">${practice === 'ccnp' ? '<link rel="stylesheet" href="/styles/ccnp.css">' : ''}<script type="module" src="/features/${practice}/app.mjs"></script>` : ''}
${route === 'labsim' ? '<link rel="stylesheet" href="/styles/labsim.css"><script type="module" src="/features/labsim/app.js"></script>' : ''}
</head>
<body class="route-${current || 'home'}${guided ? ' route-ccnp' : ''}">
<a class="skip" href="#main">${intro ? 'Skip animation' : 'Skip to content'}</a>
<header class="site-header" data-nav-theme="${current || 'home'}"><div class="nav-wrap">
<a class="brand" href="/" aria-label="Netra home">${logo}</a>
<nav aria-label="Main navigation">${links(current)}</nav>
<a class="header-cta" href="${route === 'labsim' ? '/' : '/labsim/'}">${route === 'labsim' ? 'Back to home' : guided ? 'Open sandbox' : '<span aria-hidden="true">›_</span> Open LabSim'}</a>
</div></header>
${intro || ''}
<main id="main" tabindex="-1">${content}</main>
<footer class="site-footer"><div class="frame footer-grid">
<div><a class="brand" href="/" aria-label="Netra home">${logo}</a><p>Learn. Simulate. Master.</p></div>
<nav aria-label="Footer navigation">${links(current)}</nav>
<a class="repo-link" href="https://github.com/mohamadreza121/netra">GitHub</a>
</div><div class="frame footer-base"><span>© Netra</span><span>Independent networking education project.</span></div></footer>
</body>
</html>`;
}
