const header = document.querySelector('.site-header');
const hero = document.querySelector('.hero');
const stage = hero.querySelector('.rack-stage');
const title = hero.querySelector('.rack-title');
const letters = [...title.querySelectorAll('i')];
const modules = [...hero.querySelectorAll('[data-rack-module]')];
const words = [...hero.querySelectorAll('[data-rack-word]')];
const deviceFaces = modules.map(module => [...module.querySelectorAll('.device-face')]);
const panels = [...document.querySelectorAll('main > section')];
const motion = matchMedia('(prefers-reduced-motion: reduce)');

const chapters = [
  { start: .13, dock: .35, end: .42 },
  { start: .39, dock: .62, end: .69 },
  { start: .66, dock: .89, end: .96 }
];

let frame;
let navFade;
let drawnProgress;
const clamp = value => Math.max(0, Math.min(value, 1));
const progressBetween = (value, start, end) => clamp((value - start) / (end - start));
const smooth = value => value * value * (3 - 2 * value);

function dockNavigation(atTop) {
  if (header.hasAttribute('data-docked-top') === atTop) return;

  const opacity = getComputedStyle(header).opacity;
  navFade?.cancel();
  header.toggleAttribute('data-docked-top', atTop);
  if (!motion.matches) {
    navFade = header.animate([{ opacity }, { opacity: .5 }, { opacity: 1 }], {
      duration: 640,
      easing: 'cubic-bezier(.35, 0, .3, 1)'
    });
  }
}

function updateFasteners(faces, progress, dock) {
  const flightStart = dock - .047;
  const flightEnd = dock + .019;
  const lockEnd = dock + .058;

  faces.forEach((face, index) => {
    const stagger = index * .012;
    const flight = progressBetween(progress, flightStart + stagger, flightEnd + stagger);
    const tightening = smooth(progressBetween(progress, flightEnd + stagger, lockEnd + stagger));
    face.style.setProperty('--screw-travel', 1 - smooth(flight));
    face.style.setProperty('--screw-inset', tightening);
    face.style.setProperty('--screw-opacity', flight > 0 ? 1 : 0);
  });

  return progress >= lockEnd + (faces.length - 1) * .012;
}

function updateNavigationTheme(atTop, height) {
  let theme = 'home';
  if (atTop) {
    for (const panel of panels) {
      if (panel.getBoundingClientRect().top <= height + 1) theme = panel.id;
    }
  }
  if (header.dataset.navTheme !== theme) header.dataset.navTheme = theme;
}

function draw() {
  frame = undefined;
  const bounds = hero.getBoundingClientRect();
  const stageHeight = stage.offsetHeight;
  const reduced = motion.matches;
  const headerHeight = header.offsetHeight;
  const atTop = bounds.bottom <= (reduced ? headerHeight : stageHeight + 1);
  dockNavigation(atTop);
  updateNavigationTheme(atTop, headerHeight);
  if (reduced) return;

  const travel = hero.offsetHeight - stageHeight;
  const progress = travel > 0 ? clamp(-bounds.top / travel) : 0;
  if (progress === drawnProgress) return;
  drawnProgress = progress;

  const split = smooth(progressBetween(progress, .02, .19));
  const reveal = smooth(progressBetween(progress, .02, .26));

  stage.style.setProperty('--rack-reveal', reveal);
  stage.style.setProperty('--rack-finish', smooth(progressBetween(progress, .88, .99)));
  title.style.opacity = 1 - split;
  letters.forEach((letter, index) => {
    const direction = index - 2;
    letter.style.transform = `translate(${direction * split * 1.2}em, ${split * (.14 + Math.abs(direction) * .38)}em) rotate(${direction * split * 16}deg)`;
  });

  chapters.forEach(({ start, dock, end }, index) => {
    const arrival = smooth(progressBetween(progress, start, dock));
    const wordStart = index === 0 ? start : chapters[index - 1].end;
    const wordIn = smooth(progressBetween(progress, wordStart, wordStart + .06));
    const wordOut = smooth(progressBetween(progress, dock + .014, end));

    modules[index].style.setProperty('--distance', 1 - arrival);
    modules[index].toggleAttribute('data-powered', updateFasteners(deviceFaces[index], progress, dock));
    words[index].style.opacity = wordIn * (1 - wordOut);
    words[index].style.transform = `translateY(${(1 - wordIn) * 18 - wordOut * 18}px)`;
  });
}

function schedule() {
  if (frame === undefined) frame = requestAnimationFrame(draw);
}

function configure() {
  drawnProgress = undefined;
  hero.toggleAttribute('data-animated', !motion.matches);
  if (motion.matches) {
    navFade?.cancel();
    modules.forEach(module => module.removeAttribute('data-powered'));
    stage.removeAttribute('style');
    title.removeAttribute('style');
    [...letters, ...modules, ...words, ...deviceFaces.flat()].forEach(element => element.removeAttribute('style'));
  }
  schedule();
}

function measureHeader() {
  document.body.style.setProperty('--home-nav-height', `${header.offsetHeight}px`);
  schedule();
}

const panelSizes = new ResizeObserver(entries => {
  for (const { target } of entries) {
    target.style.setProperty('--panel-height', `${target.offsetHeight}px`);
  }
});
panels.forEach(panel => panelSizes.observe(panel));
new ResizeObserver(measureHeader).observe(header);
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('resize', schedule);
measureHeader();
configure();
motion.addEventListener('change', configure);
