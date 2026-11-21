const hero = document.querySelector('.hero');
const stage = hero.querySelector('.rack-stage');
const title = hero.querySelector('.rack-title');
const letters = [...title.querySelectorAll('i')];
const modules = [...hero.querySelectorAll('[data-rack-module]')];
const words = [...hero.querySelectorAll('[data-rack-word]')];
const motion = matchMedia('(prefers-reduced-motion: reduce)');

const chapters = [
  { start: .13, dock: .35, end: .42 },
  { start: .39, dock: .62, end: .69 },
  { start: .66, dock: .89, end: .96 }
];

let frame;
const clamp = value => Math.max(0, Math.min(value, 1));
const progressBetween = (value, start, end) => clamp((value - start) / (end - start));
const smooth = value => value * value * (3 - 2 * value);

function draw() {
  frame = undefined;
  const travel = hero.offsetHeight - stage.offsetHeight;
  const progress = travel > 0 ? clamp(-hero.getBoundingClientRect().top / travel) : 0;
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
    words[index].style.opacity = wordIn * (1 - wordOut);
    words[index].style.transform = `translateY(${(1 - wordIn) * 18 - wordOut * 18}px)`;
  });
}

function schedule() {
  if (frame === undefined) frame = requestAnimationFrame(draw);
}

function configure() {
  hero.toggleAttribute('data-animated', !motion.matches);
  if (!motion.matches) {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    draw();
  } else {
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    cancelAnimationFrame(frame);
    frame = undefined;
    stage.removeAttribute('style');
    title.removeAttribute('style');
    [...letters, ...modules, ...words].forEach(element => element.removeAttribute('style'));
  }
}

configure();
motion.addEventListener('change', configure);
