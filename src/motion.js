const letters = [...document.querySelectorAll('.hero h1 i')];
const hero = document.querySelector('.hero');
const ccnp = document.querySelector('.ccnp-section');
const rail = document.querySelector('.topic-rail');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let frame;

function updateMotion() {
  frame = undefined;
  if (motion.matches) return;

  const departure = Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / (hero.offsetHeight * 0.58)));
  letters.forEach((letter, index) => {
    const drift = index - 2.5;
    letter.style.transform = `translate(${drift * departure * 30}px, ${departure * departure * (65 + index * 18)}px) rotate(${departure * drift * 8}deg)`;
    letter.style.opacity = 1 - departure * 0.93;
  });
  const entry = Math.max(0, Math.min(1, ccnp.getBoundingClientRect().top / innerHeight));
  rail.style.setProperty('--rail-entry', `${entry * entry * 115}px`);
}

if (hero && ccnp && rail) {
  window.addEventListener('scroll', () => {
    if (frame === undefined) frame = requestAnimationFrame(updateMotion);
  }, { passive: true });
  motion.addEventListener('change', () => {
    letters.forEach(letter => letter.removeAttribute('style'));
    rail.style.removeProperty('--rail-entry');
    updateMotion();
  });
  updateMotion();
  document.querySelectorAll('[data-rail-step]').forEach(button => {
    button.addEventListener('click', () => rail.scrollBy({
      left: Number(button.dataset.railStep) * (rail.firstElementChild.offsetWidth + 16),
      behavior: motion.matches ? 'instant' : 'smooth'
    }));
  });
}
