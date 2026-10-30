import { SVG_TOKENS, type ThemeChoice, type Token, TOKENS } from "./trajectory-palette.js";

export const FONT = "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Ink {
  readonly fill?: Token | `url(#${string})`;
  readonly stroke?: Token;
  readonly cls?: string;
}

const base = (theme: ThemeChoice): Readonly<Record<Token, string>> => SVG_TOKENS[theme === "dark" ? "dark" : "light"];

const isToken = (value: string): value is Token => (TOKENS as readonly string[]).includes(value);

export const paint = (theme: ThemeChoice, ink: Ink): string => {
  const tokens = base(theme);
  const fill = ink.fill;
  const classes = [
    ...(ink.cls === undefined ? [] : [ink.cls]),
    ...(fill !== undefined && isToken(fill) ? [`f-${fill}`] : []),
    ...(ink.stroke === undefined ? [] : [`s-${ink.stroke}`]),
  ];
  const fillValue = fill === undefined ? "none" : isToken(fill) ? tokens[fill] : fill;
  return [
    ...(classes.length === 0 ? [] : [`class="${classes.join(" ")}"`]),
    `fill="${fillValue}"`,
    ...(ink.stroke === undefined ? [] : [`stroke="${tokens[ink.stroke]}"`]),
  ].join(" ");
};

export const styleOf = (theme: ThemeChoice): string => {
  if (theme !== "auto") return "";
  const dark = SVG_TOKENS.dark;
  const rules = TOKENS.map((token) => `.f-${token}{fill:${dark[token]}}.s-${token}{stroke:${dark[token]}}`).join("");
  return `<style>@media (prefers-color-scheme: dark){${rules}}</style>`;
};

export const text = (
  theme: ThemeChoice,
  at: { readonly x: number; readonly y: number },
  body: string,
  options: { readonly size?: number; readonly fill?: Token; readonly anchor?: string; readonly extra?: string } = {},
): string =>
  `<text x="${num(at.x)}" y="${num(at.y)}" font-family="${FONT}" font-size="${String(options.size ?? 10.5)}"${options.anchor === undefined ? "" : ` text-anchor="${options.anchor}"`}${options.extra === undefined ? "" : ` ${options.extra}`} ${paint(theme, { fill: options.fill ?? "faint" })}>${escapeXml(body)}</text>`;

export const num = (value: number): string => String(Math.round(value * 10) / 10);

export const defsOf = (theme: ThemeChoice): string =>
  [
    "<defs>",
    `<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" ${paint(theme, { fill: "b1" })}/><line x1="0" y1="0" x2="0" y2="7" stroke-width="1.1" stroke-opacity="0.5" ${paint(theme, { stroke: "bInk" })}/></pattern>`,
    `<pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" ${paint(theme, { fill: "bCov" })}/><circle cx="3" cy="3" r="0.9" fill-opacity="0.55" ${paint(theme, { fill: "bCovInk" })}/></pattern>`,
    `<pattern id="gap" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" ${paint(theme, { fill: "bg" })}/><line x1="0" y1="0" x2="0" y2="5" stroke-width="1" ${paint(theme, { stroke: "rule" })}/></pattern>`,
    "</defs>",
  ].join("");
