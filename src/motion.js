const letters = [...document.querySelectorAll('.hero h1 i')];
const hero = document.querySelector('.hero');
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
}

if (hero) {
  window.addEventListener('scroll', () => {
    if (frame === undefined) frame = requestAnimationFrame(updateMotion);
  }, { passive: true });
  motion.addEventListener('change', () => {
    letters.forEach(letter => letter.removeAttribute('style'));
    updateMotion();
  });
  updateMotion();
}
