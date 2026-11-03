import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import { siteCss } from "./essays-css.js";
import { hero } from "./essays-hero.js";
import { escapeHtml, inline, type LinkMap, parseBlocks, plain, renderBlocks } from "./essays-markdown.js";
import { page } from "./essays-page.js";
import { type Essay, ESSAYS, type Lang, LANGS, REPO, UI } from "./essays-text.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const SITE_DIR = "site/essays";
const WORDS_PER_MINUTE = 230;

const langOf = (suffix: string | undefined): Lang => (suffix === ".pt-BR" ? "pt" : suffix === ".es" ? "es" : "en");
const pageFile = (lang: Lang): string => (lang === "en" ? "" : UI[lang].file);
const mdPath = (essay: Essay, lang: Lang): string => `docs/${essay.slug}/${essay.slug}${UI[lang].mdSuffix}.md`;

function linkMap(essay: Essay): LinkMap {
  return (target) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return target;
    if (target.startsWith("figures/")) return target;
    const readme = /^(?:\.\.\/)+README(\.pt-BR|\.es)?\.md$/.exec(target);
    if (readme) return `../../?lang=${langOf(readme[1])}`;
    const other = /^(?:\.\.\/([\w-]+)\/)?([\w-]+?)(\.pt-BR|\.es)?\.md$/.exec(target);
    if (other && ESSAYS.some((e) => e.slug === other[2])) {
      const file = pageFile(langOf(other[3]));
      return other[1] ? `../${other[1]}/${file}` : file || "./";
    }
    return `${REPO}/blob/main/${posix.normalize(posix.join("docs", essay.slug, target))}`;
  };
}

function figureHtml(essay: Essay, lang: Lang): (src: string, caption: string) => string {
  return (src, caption) => {
    const svg = readFileSync(join(root, "docs", essay.slug, src), "utf8");
    const width = /<svg[^>]*\swidth="(\d+)/.exec(svg)?.[1] ?? "1200";
    const height = /<svg[^>]*\sheight="(\d+)/.exec(svg)?.[1] ?? "600";
    const split = /\s((?:Source|Fonte|Fuente):.*)$/.exec(caption);
    const main = split ? caption.slice(0, split.index) : caption;
    const note = split ? ` <span class="src">${split[1] ?? ""}</span>` : "";
    const alt = escapeHtml(plain(main));
    return `<figure class="fig">
<a class="plate" href="${src}" title="${escapeHtml(UI[lang].fullSize)}"><img src="${src}" width="${width}" height="${height}" loading="lazy" decoding="async" alt="${alt}" /></a>
<figcaption>${main}${note}</figcaption>
</figure>`;
  };
}

interface Front {
  readonly title: string;
  readonly byline: readonly string[];
  readonly version: string;
  readonly rest: string;
}

function front(markdown: string, link: LinkMap): Front {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const end = lines.findIndex((line, i) => i > 0 && (line.startsWith(">") || line.startsWith("## ")));
  const groups = lines
    .slice(1, end)
    .join("\n")
    .split(/\n\s*\n/)
    .map((g) => g.trim())
    .filter(Boolean);
  const byline = (groups[0] ?? "").split("\n").map((line) => inline(line.trim(), link));
  const version = (groups[1] ?? "").replace(/\s+\[?English\b.*$/, "").replace(/\.$/, "");
  return { title: (lines[0] ?? "").replace(/^#\s+/, ""), byline, version, rest: lines.slice(end).join("\n") };
}

function essayPage(essay: Essay, lang: Lang): string {
  const markdown = readFileSync(join(root, mdPath(essay, lang)), "utf8");
  const link = linkMap(essay);
  const head = front(markdown, link);
  const rendered = renderBlocks(parseBlocks(head.rest), { link, figure: figureHtml(essay, lang) });
  return page({
    essay,
    lang,
    title: head.title,
    byline: head.byline,
    version: head.version,
    body: rendered.body,
    headings: rendered.headings,
    minutes: Math.max(1, Math.round(rendered.words / WORDS_PER_MINUTE)),
    hero: hero(essay.slug, essay.hero[lang], head.title),
    githubUrl: `${REPO}/blob/main/${mdPath(essay, lang)}`,
  });
}

function figures(essay: Essay): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const base = join(root, "docs", essay.slug, "figures");
  for (const dir of readdirSync(base)) {
    for (const file of readdirSync(join(base, dir)).filter((f) => f.endsWith(".svg"))) {
      out.set(`${SITE_DIR}/${essay.slug}/figures/${dir}/${file}`, readFileSync(join(base, dir, file)));
    }
  }
  return out;
}

async function outputs(): Promise<Map<string, string | Buffer>> {
  const config = (await resolveConfig(join(root, "site/index.html"))) ?? {};
  const out = new Map<string, string | Buffer>();
  const index = readFileSync(join(root, "site/index.html"), "utf8");
  out.set(`${SITE_DIR}/site.css`, await format(siteCss(index), { ...config, parser: "css" }));
  for (const essay of ESSAYS) {
    for (const lang of LANGS) {
      const html = await format(essayPage(essay, lang), { ...config, parser: "html" });
      out.set(`${SITE_DIR}/${essay.slug}/${UI[lang].file}`, html);
    }
    for (const [file, data] of figures(essay)) out.set(file, data);
  }
  return out;
}

function same(file: string, data: string | Buffer): boolean {
  try {
    const current = readFileSync(join(root, file));
    return typeof data === "string" ? current.toString("utf8") === data : current.equals(data);
  } catch {
    return false;
  }
}

const check = process.argv.includes("--check");
const stale: string[] = [];
for (const [file, data] of await outputs()) {
  if (same(file, data)) continue;
  if (check) {
    stale.push(file);
    continue;
  }
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), data);
}
for (const file of stale) console.error(`${file} is out of date. Run \`npm run site:essays\`.`);
if (stale.length > 0) process.exit(1);
console.log(check ? "essay pages are up to date" : "essay pages written");
