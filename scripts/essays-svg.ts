export interface SvgItem {
  readonly raw: string;
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface ParsedSvg {
  readonly open: string;
  readonly head: string;
  readonly items: readonly SvgItem[];
}

export const ANIMS = ["up", "right", "draw", "fade", "slide", "pop", "count", "seat"] as const;
export type Anim = (typeof ANIMS)[number];

export interface Motion {
  readonly a: Anim;
  readonly t: number;
  readonly d?: number | undefined;
  readonly from?: number | undefined;
  readonly chain?: boolean | undefined;
}

const ITEM = /<g\b[^>]*>[\s\S]*?<\/g>|<(rect|line|path|circle|text)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;

function attrsOf(raw: string): Record<string, string> {
  const open = raw.slice(0, raw.indexOf(">"));
  const out: Record<string, string> = {};
  for (const m of open.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

export function parseSvg(text: string): ParsedSvg {
  const split = text.indexOf("</defs>") + "</defs>".length;
  const open = /^<svg\b[^>]*>/.exec(text)?.[0] ?? "<svg>";
  const body = text.slice(split, text.lastIndexOf("</svg>"));
  const items = [...body.matchAll(ITEM)].map((m) => {
    const raw = m[0];
    return { raw, tag: m[1] ?? "g", attrs: attrsOf(raw) };
  });
  return { open, head: text.slice(open.length, split), items };
}

export const num = (item: SvgItem, key: string): number => Number(item.attrs[key] ?? "0");

export function makeItem(raw: string): SvgItem {
  const tag = /^<(\w+)/.exec(raw)?.[1] ?? "g";
  return { raw, tag, attrs: attrsOf(raw) };
}

export function annotate(item: SvgItem, motion: Motion): string {
  const parts = [`data-a="${motion.a}"`, `data-t="${motion.t.toFixed(3)}"`];
  if (motion.d !== undefined) parts.push(`data-d="${motion.d.toFixed(3)}"`);
  if (motion.from !== undefined) parts.push(`data-from="${String(motion.from)}"`);
  if (motion.chain) parts.push(`data-c="1"`);
  return item.raw.replace(/^<(\w+)/, `<$1 ${parts.join(" ")}`);
}

export function prefixIds(text: string, prefix: string): string {
  return text.replace(/\bid="([\w-]+)"/g, `id="${prefix}$1"`).replace(/url\(#([\w-]+)\)/g, `url(#${prefix}$1)`);
}

export function serialize(svg: ParsedSvg, body: readonly string[]): string {
  return `${svg.open}${svg.head}${body.join("")}</svg>`;
}
