import { brandLink } from "./essays-brand.js";
import { escapeHtml, type Heading } from "./essays-markdown.js";
import { type Essay, type Lang, LANGS, SITE, UI } from "./essays-text.js";

export interface PageInput {
  readonly essay: Essay;
  readonly lang: Lang;
  readonly title: string;
  readonly byline: readonly string[];
  readonly version: string;
  readonly body: string;
  readonly headings: readonly Heading[];
  readonly minutes: number;
  readonly hero: string;
  readonly githubUrl: string;
}

const LABEL: Readonly<Record<Lang, string>> = { en: "EN", pt: "PT", es: "ES" };

const home = (lang: Lang, hash = ""): string => `../../?lang=${lang}${hash}`;

const pageHref = (lang: Lang): string => (lang === "en" ? "./" : UI[lang].file);

const NEGOTIATE = `<script>
(function () {
  var files = { pt: "pt.html", es: "es.html" };
  var want = new URLSearchParams(location.search).get("lang");
  if (!want) {
    try { want = localStorage.getItem("fm-lang"); } catch (e) {}
  }
  if (!want) {
    var n = (navigator.language || "").toLowerCase();
    want = n.indexOf("pt") === 0 ? "pt" : n.indexOf("es") === 0 ? "es" : "en";
  }
  if (files[want]) location.replace(files[want] + location.hash);
})();
</script>`;

const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist";

const SCRIPTS = [
  `<script defer src="${GSAP}/gsap.min.js"></script>`,
  `<script defer src="${GSAP}/ScrollTrigger.min.js"></script>`,
  `<script defer src="../../brand.js"></script>`,
  `<script defer src="../figures.js"></script>`,
].join("\n");

const BEHAVIOR = `<script>
(function () {
  document.querySelectorAll("[data-lang]").forEach(function (a) {
    a.addEventListener("click", function () {
      try { localStorage.setItem("fm-lang", a.dataset.lang); } catch (e) {}
    });
  });
  var toc = document.querySelector(".toc details");
  var wide = matchMedia("(min-width: 1000px)");
  function sync() { if (toc) toc.open = wide.matches; }
  sync();
  wide.addEventListener("change", sync);
  document.querySelectorAll(".toc a").forEach(function (a) {
    a.addEventListener("click", function () { if (toc && !wide.matches) toc.open = false; });
  });
  var links = new Map();
  document.querySelectorAll(".toc a").forEach(function (a) { links.set(a.getAttribute("href").slice(1), a); });
  if (!("IntersectionObserver" in window)) return;
  var current = null;
  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var a = links.get(e.target.id);
      if (!a) return;
      if (current) current.removeAttribute("aria-current");
      a.setAttribute("aria-current", "true");
      current = a;
    });
  }, { rootMargin: "-80px 0px -70% 0px" });
  document.querySelectorAll(".prose-long h2[id], .prose-long h3[id]").forEach(function (h) { seen.observe(h); });
})();
</script>`;

function head(input: PageInput): string {
  const ui = UI[input.lang];
  const title = escapeHtml(input.title);
  const summary = escapeHtml(input.essay.summary[input.lang]);
  const url = `${SITE}essays/${input.essay.slug}/${input.lang === "en" ? "" : ui.file}`;
  const alternates = LANGS.map(
    (l) =>
      `<link rel="alternate" hreflang="${UI[l].htmlLang}" href="${SITE}essays/${input.essay.slug}/${l === "en" ? "" : UI[l].file}" />`,
  ).join("\n");
  return `<head>
<meta charset="utf-8" />
<script>
document.documentElement.classList.add("js");
</script>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Finite Monkey</title>
<meta name="description" content="${summary}" />
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#fcfcfd" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0d1014" media="(prefers-color-scheme: dark)" />
<link rel="canonical" href="${url}" />
${alternates}
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Finite Monkey" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${summary}" />
<meta property="og:url" content="${url}" />
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23fcfcfd'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-family='ui-monospace,Menlo,Consolas,monospace' font-size='17' font-weight='800' fill='%23121519'%3Efm%3C/text%3E%3C/svg%3E" />
${input.lang === "en" ? NEGOTIATE : ""}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&amp;family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&amp;display=swap" />
<link rel="stylesheet" href="../site.css" />
<link rel="stylesheet" href="../essay.css" />
</head>`;
}

function bar(input: PageInput): string {
  const ui = UI[input.lang];
  const langs = LANGS.map(
    (l) =>
      `<a href="${pageHref(l)}" hreflang="${UI[l].htmlLang}" lang="${UI[l].htmlLang}" data-lang="${l}"${l === input.lang ? ' aria-current="page"' : ""}>${LABEL[l]}</a>`,
  ).join("");
  return `<header class="bar">
${brandLink(home(input.lang))}
<span class="tag">${escapeHtml(ui.essay(input.essay.number))}</span>
<nav class="nav" aria-label="Site">
<a href="${home(input.lang, "#essays")}">${escapeHtml(ui.essays)}</a>
<a href="${input.githubUrl}">github</a>
</nav>
<div class="seg" role="group" aria-label="${ui.languages}">${langs}</div>
</header>`;
}

function intro(input: PageInput): string {
  const ui = UI[input.lang];
  const byline = input.byline.map((line) => `<span>${line}</span>`).join("\n");
  return `<div class="art-head">
<div class="art-title">
<p class="kicker">${escapeHtml(ui.essay(input.essay.number))} · ${escapeHtml(input.version)}</p>
<h1>${escapeHtml(input.title)}</h1>
<p class="byline">${byline}</p>
<p class="meta"><span>${escapeHtml(ui.minutes(input.minutes))}</span><a href="${input.githubUrl}">${escapeHtml(ui.github)} ↗</a><a href="${home(input.lang)}">${escapeHtml(ui.back)}</a></p>
</div>
<figure class="art-hero">${input.hero}</figure>
</div>`;
}

function toc(input: PageInput): string {
  const items = input.headings
    .map((h) => `<li class="l${String(h.level)}"><a href="#${h.id}">${h.html.replace(/<\/?a[^>]*>/g, "")}</a></li>`)
    .join("\n");
  return `<aside class="toc">
<details open>
<summary>${escapeHtml(UI[input.lang].contents)}</summary>
<nav aria-label="${escapeHtml(UI[input.lang].contents)}"><ol>
${items}
</ol></nav>
</details>
</aside>`;
}

export function page(input: PageInput): string {
  const ui = UI[input.lang];
  return `<!doctype html>
<html lang="${ui.htmlLang}">
${head(input)}
<body>
<a class="skip" href="#text">${escapeHtml(ui.skip)}</a>
<div class="page" id="top">
${bar(input)}
<main>
${intro(input)}
<div class="art-body">
${toc(input)}
<article class="prose-long" id="text">
${input.body}
<p class="end"><a href="#top">${escapeHtml(ui.top)}</a> <a href="${input.githubUrl}">${escapeHtml(ui.markdown)} ↗</a></p>
</article>
</div>
</main>
<footer>
<a href="${home(input.lang)}">finitemonkey</a>
<a href="https://github.com/gabrielvieiraf/finitemonkey">github.com/gabrielvieiraf/finitemonkey</a>
<a href="https://www.npmjs.com/package/finitemonkey">npm</a>
<a href="https://github.com/gabrielvieiraf/finitemonkey/blob/main/LICENSE">Apache-2.0</a>
</footer>
</div>
${BEHAVIOR}
${SCRIPTS}
</body>
</html>
`;
}
