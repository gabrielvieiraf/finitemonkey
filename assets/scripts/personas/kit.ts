import { palette } from "../palette.ts";
import { svg } from "../svg.ts";
import { text, textWidth } from "../text.ts";

export const ink = {
  paper: "#f4f6fb",
  paperEdge: "#c3c9d8",
  line: "#b7bdcc",
  teal: "#4fd1c5",
  tealDark: "#2a9d92",
  grey: "#b9b2a8",
  orange: "#ff8a3d",
  orangeDark: "#c8601f",
  pink: "#ff8fb1",
} as const;

export function chatWindow(x: number, y: number, w: number, h: number, body: string, opacity = 1): string {
  return (
    svg`<g opacity="${opacity}">` +
    svg`<rect x="${x + 3}" y="${y + 5}" width="${w}" height="${h}" rx="9" fill="#000000" opacity="0.25"/>` +
    svg`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${ink.paper}" stroke="${ink.paperEdge}" stroke-width="2"/>` +
    svg`<path d="M${x + 1} ${y + 13}h${w - 2}" stroke="${ink.paperEdge}" stroke-width="2"/>` +
    svg`<circle cx="${x + 9}" cy="${y + 7}" r="2.5" fill="${palette.red}"/><circle cx="${x + 17}" cy="${y + 7}" r="2.5" fill="${palette.amber}"/>` +
    body +
    svg`</g>`
  );
}

export function greyLines(x: number, y: number, widths: readonly number[]): string {
  return widths
    .map((w, row) => svg`<rect x="${x}" y="${y + row * 9}" width="${w}" height="4" rx="2" fill="${ink.line}"/>`)
    .join("");
}

export function bubble(x: number, y: number, label: string, size: number, tail: "left" | "right" | "down"): string {
  const w = textWidth(label, size) + 16;
  const h = 7 * size + 12;
  const tip =
    tail === "left"
      ? svg`M${x + 10} ${y + h - 1}l-12 9l4 -9z`
      : tail === "right"
        ? svg`M${x + w - 12} ${y + h - 1}l12 9l-4 -9z`
        : svg`M${x + w / 2 - 6} ${y + h - 1}l6 9l6 -9z`;
  return (
    svg`<path d="${tip}" fill="${ink.paper}"/>` +
    svg`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${ink.paper}"/>` +
    text(label, x + 8, y + 6, size, palette.eye)
  );
}

export function note(x: number, y: number, angle: number, lines: readonly string[], size: number): string {
  const w = Math.max(38, ...lines.map((line) => textWidth(line, size) + 8));
  const h = Math.max(34, lines.length * 9 * size + 14);
  return (
    svg`<g transform="translate(${x} ${y}) rotate(${angle})">` +
    svg`<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="2" fill="${palette.note}"/>` +
    svg`<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="7" rx="2" fill="${palette.mugDark}" opacity="0.3"/>` +
    lines
      .map((line, row) =>
        text(line, -textWidth(line, size) / 2, -h / 2 + 10 + row * 9 * size, size, palette.noteInk),
      )
      .join("") +
    svg`</g>`
  );
}

export function popScale(elapsed: number): number {
  const steps = [0.3, 0.75, 1.12, 1.04, 1];
  if (elapsed < 0) return 0;
  return steps[elapsed] ?? 1;
}

export function centered(content: string, x: number, y: number, scale: number): string {
  if (scale <= 0) return "";
  return svg`<g transform="translate(${x} ${y}) scale(${scale})">${content}</g>`;
}
