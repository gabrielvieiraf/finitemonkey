(function () {
  const brand = document.querySelector(".brand[data-intro]");
  if (!brand) return;
  const reveal = () => brand.removeAttribute("data-intro");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !window.gsap) return reveal();
  const g = window.gsap;
  const head = brand.querySelector(".brand-head");
  const eyes = brand.querySelector(".brand-eyes");
  const letters = brand.querySelectorAll(".brand-word span");
  const tl = g.timeline({ defaults: { ease: "power2.out" } });
  tl.from(head, { scale: 0, rotation: -40, transformOrigin: "50% 90%", duration: 0.5, ease: "back.out(2.4)" }, 0);
  tl.from(letters, { opacity: 0, y: 5, duration: 0.22, stagger: 0.035 }, 0.18);
  tl.to(head, { rotation: 9, transformOrigin: "50% 90%", duration: 0.14, ease: "power1.out" }, 0.55);
  tl.to(head, { rotation: -5, duration: 0.16, ease: "power1.inOut" }, 0.69);
  tl.to(head, { rotation: 0, duration: 0.2, ease: "power1.out" }, 0.85);
  tl.to(eyes, { scaleY: 0.1, transformOrigin: "50% 50%", duration: 0.07, yoyo: true, repeat: 1 }, 1.1);
  reveal();
})();
