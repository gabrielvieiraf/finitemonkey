(function () {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const figures = document.querySelectorAll("svg[data-fig]");
  if (reduce || !window.gsap || !window.ScrollTrigger || figures.length === 0) return;
  const g = window.gsap;
  g.registerPlugin(window.ScrollTrigger);

  const DURATION = { up: 0.45, right: 0.5, draw: 0.5, fade: 0.4, slide: 0.45, pop: 0.45, count: 0.6, seat: 0.28 };

  function textNode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null;
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) last = walker.currentNode;
    return last;
  }

  function draw(tl, el, d, t) {
    if (el.tagName === "line") {
      const origin = el.getAttribute("x1") + " " + el.getAttribute("y1");
      tl.from(el, { scale: 0, svgOrigin: origin, duration: d, ease: "power2.inOut" }, t);
      return;
    }
    if (el.getAttribute("stroke-dasharray") || typeof el.getTotalLength !== "function") {
      tl.from(el, { opacity: 0, duration: d }, t);
      return;
    }
    const len = el.getTotalLength();
    g.set(el, { strokeDasharray: len + " " + len });
    tl.from(el, { strokeDashoffset: len, duration: d, ease: "power1.inOut" }, t);
  }

  function count(tl, el, d, t) {
    const node = textNode(el);
    if (!node) return;
    const final = node.nodeValue;
    const end = Number(final.trim());
    const start = Number(el.dataset.from || 0);
    if (!Number.isFinite(end)) return;
    const box = { v: start };
    node.nodeValue = String(start);
    tl.from(el, { opacity: 0, duration: 0.2 }, t);
    tl.to(
      box,
      {
        v: end,
        duration: d,
        ease: "power1.out",
        onUpdate: () => (node.nodeValue = String(Math.round(box.v))),
        onComplete: () => (node.nodeValue = final),
      },
      t,
    );
  }

  const MOVES = {
    up: (el) => ({ scaleY: 0, transformOrigin: "50% 100%", ease: el.dataset.c ? "none" : "power2.out" }),
    right: (el) => ({ scaleX: 0, transformOrigin: "0% 50%", ease: el.dataset.c ? "none" : "power2.out" }),
    fade: (el) => (el.tagName === "g" ? { opacity: 0 } : { opacity: 0, y: 6 }),
    slide: () => ({ opacity: 0, y: 14, ease: "power3.out" }),
    pop: () => ({ opacity: 0, scale: 0.6, transformOrigin: "50% 50%", ease: "back.out(2.2)" }),
    seat: () => ({ opacity: 0, scale: 0, transformOrigin: "50% 50%", ease: "back.out(2.6)" }),
  };

  function add(tl, el) {
    const a = el.dataset.a;
    const t = Number(el.dataset.t);
    const d = el.dataset.d ? Number(el.dataset.d) : DURATION[a];
    if (a === "draw") return draw(tl, el, d, t);
    if (a === "count") return count(tl, el, d, t);
    const move = MOVES[a];
    if (!move) return;
    tl.from(el, Object.assign({ duration: d }, move(el)), t);
  }

  figures.forEach((svg) => {
    const tl = g.timeline({ paused: true, defaults: { ease: "power2.out" } });
    svg.querySelectorAll("[data-a]").forEach((el) => add(tl, el));
    window.ScrollTrigger.create({ trigger: svg, start: "top 85%", once: true, onEnter: () => tl.play() });
  });
})();
