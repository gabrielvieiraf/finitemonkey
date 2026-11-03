import { escapeHtml } from "./essays-markdown.js";
import { type HeroId, type HeroLabels } from "./essays-text.js";

const t = (x: number, y: number, cls: string, text: string, anchor = "start"): string =>
  `<text x="${String(x)}" y="${String(y)}" class="${cls}" text-anchor="${anchor}">${escapeHtml(text)}</text>`;

const PATTERNS = `<defs>
<pattern id="hero-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" class="s-hatch-bg" /><line x1="0" y1="0" x2="0" y2="7" class="s-hatch-ln" /></pattern>
<pattern id="hero-dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" class="s-dots-bg" /><circle cx="3" cy="3" r="0.9" class="s-dots-dot" /></pattern>
</defs>`;

const ricochetMark = (x: number, y: number): string =>
  `<g class="mark"><circle cx="${String(x)}" cy="${String(y)}" r="7" class="mr-c" /><path d="M ${String(x - 3.2)} ${String(y - 3.2)} L ${String(x + 3.2)} ${String(y + 3.2)} M ${String(x + 3.2)} ${String(y - 3.2)} L ${String(x - 3.2)} ${String(y + 3.2)}" class="mr-x" /></g>`;

const holdMark = (x: number, y: number): string =>
  `<g class="mark"><circle cx="${String(x)}" cy="${String(y)}" r="7" class="mh-c" /><circle cx="${String(x)}" cy="${String(y)}" r="2.8" class="mh-d" /></g>`;

function ricochet(l: HeroLabels): string {
  return [
    `<g class="strata">`,
    `<rect x="40" y="24" width="440" height="78" fill="url(#hero-hatch)" />`,
    `<rect x="40" y="102" width="440" height="22" fill="url(#hero-dots)" />`,
    `<rect x="40" y="124" width="440" height="12" class="s-d" />`,
    `<rect x="40" y="136" width="440" height="26" class="s-p1" />`,
    `<rect x="40" y="162" width="440" height="40" class="s-p2" />`,
    `<rect x="40" y="202" width="440" height="34" class="s-a1" />`,
    `<rect x="40" y="236" width="440" height="40" class="s-a2" />`,
    `</g>`,
    `<line x1="40" y1="102" x2="480" y2="102" class="ceil dash" />`,
    `<line x1="40" y1="136" x2="480" y2="136" class="ceil" />`,
    `<line x1="40" y1="202" x2="480" y2="202" class="ceil" />`,
    `<rect x="40" y="24" width="440" height="252" class="frame" />`,
    `<line x1="32" y1="130" x2="40" y2="130" class="tj-disc-tick" />`,
    `<line x1="318" y1="24" x2="318" y2="276" class="ceil dash" />`,
    `<line x1="26" y1="276" x2="494" y2="276" class="axis" />`,
    t(472, 44, "tj-tick", l.a, "end"),
    t(472, 120, "tj-disc", l.b, "end"),
    t(472, 194, "tj-tick", l.c, "end"),
    t(472, 266, "tj-tick", l.d, "end"),
    t(318, 294, "tj-tick", l.e, "middle"),
    t(150, 294, "tj-tick", l.f, "middle"),
    `<path d="M 62 222 C 140 222, 200 70, 318 64 C 360 62, 390 190, 440 222" class="work" />`,
    `<path d="M 62 222 C 150 222, 220 150, 318 150 C 370 150, 400 154, 440 154" class="work alt" />`,
    `<circle cx="318" cy="64" r="5" class="peak" />`,
    `<circle cx="318" cy="150" r="4" class="peak alt" />`,
    ricochetMark(440, 222),
    holdMark(440, 154),
  ].join("\n");
}

const lines = (x: number, y: number, widths: readonly number[], cls = "ln"): string =>
  widths
    .map(
      (w, i) =>
        `<line x1="${String(x)}" y1="${String(y + i * 11)}" x2="${String(x + w)}" y2="${String(y + i * 11)}" class="${cls}" />`,
    )
    .join("\n");

function notes(l: HeroLabels): string {
  return [
    `<rect x="40" y="40" width="112" height="68" class="card fill" />`,
    lines(52, 58, [80, 64, 72, 44]),
    `<rect x="40" y="124" width="112" height="68" fill="url(#hero-hatch)" class="card" />`,
    lines(52, 142, [76, 60, 70, 40], "ln dim"),
    `<rect x="40" y="208" width="112" height="68" fill="url(#hero-dots)" class="card" />`,
    lines(52, 226, [70, 82, 50, 62], "ln dim"),
    t(40, 30, "tj-h", l.a),
    t(96, 294, "tj-tick", l.f, "middle"),
  ].join("\n");
}

function claims(l: HeroLabels): string {
  return [
    t(196, 30, "tj-h", l.b),
    `<rect x="196" y="60" width="128" height="52" class="card s-a1" />`,
    lines(208, 76, [92, 70]),
    t(208, 104, "hash", "#3f2a91"),
    `<rect x="196" y="176" width="128" height="52" class="card s-hatch-bg" />`,
    lines(208, 192, [88, 64]),
    t(208, 220, "hash bad", "#a07c1e"),
  ].join("\n");
}

function code(l: HeroLabels): string {
  return [
    t(370, 30, "tj-h", l.c),
    `<rect x="370" y="40" width="110" height="236" class="card fill" />`,
    `<rect x="370" y="40" width="110" height="18" class="s-p1" />`,
    t(378, 53, "hash", "tree 3f2a91"),
    lines(380, 74, [70, 52, 84, 60, 38], "ln"),
    `<rect x="376" y="68" width="98" height="52" class="anchor" />`,
    lines(380, 144, [64, 78, 46], "ln"),
    `<rect x="376" y="182" width="98" height="40" class="anchor bad" />`,
    lines(380, 194, [74, 58, 80], "ln"),
    lines(380, 246, [56, 72], "ln"),
  ].join("\n");
}

function secondBrain(l: HeroLabels): string {
  return [
    notes(l),
    claims(l),
    code(l),
    `<path d="M 324 86 C 346 86, 352 94, 376 94" class="link ok" />`,
    `<path d="M 324 202 C 346 202, 352 202, 376 202" class="link bad" />`,
    holdMark(350, 90),
    ricochetMark(350, 202),
    t(260, 136, "tj-tick", l.d, "middle"),
    t(260, 252, "tj-tick", l.e, "middle"),
    `<line x1="26" y1="276" x2="494" y2="276" class="axis" />`,
  ].join("\n");
}

export function hero(id: HeroId, labels: HeroLabels, title: string): string {
  const body = id === "ricochet" ? ricochet(labels) : secondBrain(labels);
  return `<svg class="traj hero-art" viewBox="0 0 520 304" role="img" aria-label="${escapeHtml(title)}">\n${PATTERNS}\n${body}\n</svg>`;
}
