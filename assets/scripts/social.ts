import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import { monkeyBody } from "./monkey.ts";
import { palette } from "./palette.ts";
import { laptop, mouseOnDesk, mug } from "./props.ts";
import { svg } from "./svg.ts";
import { advance, text } from "./text.ts";

const width = 1280;
const height = 640;
const scale = 1.6;
const deskTop = 560;
const shift = { x: -54, y: deskTop - 322 * scale };
const column = 560;
const mark = 8;
const line = 3.5;
const small = 2.5;

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "..", "social.png");

function scaled(content: string): string {
  return svg`<g transform="translate(${shift.x} ${shift.y}) scale(${scale})">${content}</g>`;
}

function background(): string {
  return (
    svg`<defs>` +
    svg`<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.cardTop}"/><stop offset="1" stop-color="${palette.cardBottom}"/></linearGradient>` +
    svg`<radialGradient id="glow"><stop offset="0" stop-color="${palette.glow}"/><stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/></radialGradient>` +
    svg`</defs>` +
    svg`<rect width="${width}" height="${height}" fill="url(#wall)"/>` +
    svg`<ellipse cx="300" cy="360" rx="300" ry="260" fill="url(#glow)" opacity="0.14"/>`
  );
}

function deskBand(): string {
  return (
    svg`<rect x="0" y="${deskTop}" width="${width}" height="22" fill="${palette.deskTop}"/>` +
    svg`<rect x="0" y="${deskTop + 22}" width="${width}" height="${height - deskTop - 22}" fill="${palette.deskFront}"/>` +
    svg`<path d="M0 ${deskTop + 22}h${width}" stroke="${palette.deskLine}" stroke-width="4"/>`
  );
}

function words(): string {
  return (
    text("Finite", column, 160, mark, palette.text) +
    text("Monkey", column + 7 * advance * mark, 160, mark, palette.hoodie) +
    text("Infinite monkeys not required.", column, 290, line, palette.text) +
    text("One is enough:", column, 342, line, palette.text) +
    text("you.", column + 15 * advance * line, 342, line, palette.hoodie) +
    text("A definition of done for Claude Code", column, 444, small, palette.dim) +
    text("✓ actually done", column, 494, small, palette.green)
  );
}

function scene(): string {
  return (
    svg`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    background() +
    scaled(monkeyBody({ mood: "pleased", beat: 0 })) +
    deskBand() +
    scaled(laptop() + mug(0) + mouseOnDesk()) +
    words() +
    svg`</svg>`
  );
}

const png = new Resvg(scene(), { fitTo: { mode: "width", value: width } }).render().asPng();
writeFileSync(output, png);
process.stdout.write(`${output}: ${String(width)}x${String(height)}, ${String(Math.round(png.length / 1024))} KiB\n`);
