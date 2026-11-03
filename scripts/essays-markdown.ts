export type LinkMap = (target: string) => string;

export interface Heading {
  readonly level: 2 | 3;
  readonly id: string;
  readonly html: string;
}

export interface Rendered {
  readonly body: string;
  readonly headings: readonly Heading[];
  readonly words: number;
}

type Block =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "para"; readonly text: string }
  | { readonly kind: "quote"; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: "table"; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: "image"; readonly alt: string; readonly src: string };

const ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const SOURCE = /^(?:Source|Fonte|Fuente):/;
const REFERENCES = new Set(["References", "Referências", "Referencias"]);

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);
}

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const anchor = (href: string, text: string): string => `<a href="${href}">${text}</a>`;

function spans(text: string, link: LinkMap): string {
  return text
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_m, url: string) => anchor(url, url))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => anchor(link(url), label))
    .replace(/(^|\s)(https?:\/\/[^\s<"]*[^\s<".,;:)])/g, (_m, lead: string, url: string) => lead + anchor(url, url))
    .replace(
      /\bDOI: (10\.\d{4,}\/[^\s<]*[^\s<.,;])/g,
      (_m, doi: string) => `DOI: ${anchor(`https://doi.org/${doi}`, doi)}`,
    )
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s](?:[^*]*?[^*\s])?)\*/g, "<em>$1</em>");
}

export function inline(text: string, link: LinkMap): string {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : spans(escapeHtml(part), link)))
    .join("");
}

export function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

function take(lines: readonly string[], start: number, test: (line: string) => boolean): string[] {
  const out: string[] = [];
  for (let i = start; i < lines.length && test(lines[i] ?? ""); i++) out.push(lines[i] ?? "");
  return out;
}

function blockAt(lines: readonly string[], i: number): { block: Block; next: number } {
  const line = lines[i] ?? "";
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading)
    return { block: { kind: "heading", level: heading[1]?.length ?? 2, text: heading[2] ?? "" }, next: i + 1 };
  const image = IMAGE.exec(line.trim());
  if (image) return { block: { kind: "image", alt: image[1] ?? "", src: image[2] ?? "" }, next: i + 1 };
  if (line.startsWith(">")) {
    const got = take(lines, i, (l) => l.startsWith(">"));
    return { block: { kind: "quote", text: got.map((l) => l.replace(/^>\s?/, "")).join(" ") }, next: i + got.length };
  }
  if (line.startsWith("|")) {
    const got = take(lines, i, (l) => l.startsWith("|"));
    const rows = got.filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim())).map(cells);
    return { block: { kind: "table", rows }, next: i + got.length };
  }
  const item = /^(?:[-*]|\d+\.)\s+/;
  if (item.test(line)) {
    const got = take(lines, i, (l) => item.test(l));
    const items = got.map((l) => l.replace(item, ""));
    return { block: { kind: "list", ordered: /^\d/.test(line), items }, next: i + got.length };
  }
  const got = take(lines, i, (l) => l.trim() !== "" && !/^(#|>|\||!\[)/.test(l) && !item.test(l));
  return { block: { kind: "para", text: got.join(" ") }, next: i + Math.max(got.length, 1) };
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? "").trim() === "") {
      i++;
      continue;
    }
    const { block, next } = blockAt(lines, i);
    blocks.push(block);
    i = next;
  }
  return blocks;
}

export interface FigureOptions {
  readonly link: LinkMap;
  readonly figure: (src: string, caption: string) => string;
}

function table(rows: readonly (readonly string[])[], link: LinkMap): string {
  const [head, ...body] = rows;
  const th = (head ?? []).map((c) => `<th scope="col">${inline(c, link)}</th>`).join("");
  const tr = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c, link)}</td>`).join("")}</tr>`).join("\n");
  return `<div class="tablewrap" tabindex="0"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${tr}\n</tbody>\n</table></div>`;
}

function captionOf(block: Block | undefined): string | undefined {
  if (block?.kind !== "para") return undefined;
  const match = /^\*([^*].*[^*])\*$/.exec(block.text.trim());
  return match?.[1];
}

interface State {
  readonly out: string[];
  readonly headings: Heading[];
  readonly ids: Set<string>;
  inRefs: boolean;
  words: number;
}

function uniqueId(state: State, text: string): string {
  const base = slugify(text) || "section";
  let id = base;
  for (let n = 2; state.ids.has(id); n++) id = `${base}-${String(n)}`;
  state.ids.add(id);
  return id;
}

function heading(state: State, block: { level: number; text: string }, link: LinkMap): void {
  const level = block.level <= 2 ? 2 : 3;
  const html = inline(block.text, link);
  const id = uniqueId(state, plain(html));
  state.inRefs = level === 2 && REFERENCES.has(plain(html));
  state.headings.push({ level, id, html });
  state.out.push(`<h${String(level)} id="${id}"><a class="hl" href="#${id}">${html}</a></h${String(level)}>`);
}

function count(state: State, html: string): string {
  if (!state.inRefs) state.words += plain(html).split(/\s+/).filter(Boolean).length;
  return html;
}

function paragraph(state: State, text: string, link: LinkMap): void {
  const html = count(state, inline(text, link));
  const cls = state.inRefs ? "ref" : /^\*\*[^*]+:\*\*/.test(text) ? "kw" : "";
  state.out.push(cls ? `<p class="${cls}">${html}</p>` : `<p>${html}</p>`);
}

function tableFigure(state: State, blocks: readonly Block[], i: number, link: LinkMap): number {
  const cap = blocks[i];
  const tbl = blocks[i + 1];
  const src = blocks[i + 2];
  if (cap?.kind !== "para" || tbl?.kind !== "table") return i;
  const title = inline(cap.text.replace(/^\*\*|\*\*$/g, ""), link);
  const hasSource = src?.kind === "para" && SOURCE.test(src.text);
  const note = hasSource ? `\n<p class="src">${inline(src.text, link)}</p>` : "";
  count(state, tbl.rows.flat().join(" "));
  state.out.push(`<figure class="tbl">\n<figcaption>${title}</figcaption>\n${table(tbl.rows, link)}${note}\n</figure>`);
  return i + (hasSource ? 3 : 2);
}

function step(state: State, blocks: readonly Block[], i: number, opts: FigureOptions): number {
  const block = blocks[i];
  const { link } = opts;
  if (!block) return i + 1;
  switch (block.kind) {
    case "heading":
      heading(state, block, link);
      return i + 1;
    case "image": {
      const caption = captionOf(blocks[i + 1]);
      state.out.push(opts.figure(block.src, caption === undefined ? escapeHtml(block.alt) : inline(caption, link)));
      return i + (caption === undefined ? 1 : 2);
    }
    case "quote":
      state.out.push(`<blockquote><p>${count(state, inline(block.text, link))}</p></blockquote>`);
      return i + 1;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${count(state, inline(item, link))}</li>`).join("\n");
      state.out.push(`<${tag}>\n${items}\n</${tag}>`);
      return i + 1;
    }
    case "table":
      state.out.push(table(block.rows, link));
      return i + 1;
    case "para": {
      const next = /^\*\*[^*]+\*\*$/.test(block.text.trim()) ? tableFigure(state, blocks, i, link) : i;
      if (next !== i) return next;
      paragraph(state, block.text, link);
      return i + 1;
    }
  }
}

export function renderBlocks(blocks: readonly Block[], opts: FigureOptions): Rendered {
  const state: State = { out: [], headings: [], ids: new Set(), inRefs: false, words: 0 };
  let i = 0;
  while (i < blocks.length) i = step(state, blocks, i, opts);
  return { body: state.out.join("\n"), headings: state.headings, words: state.words };
}
