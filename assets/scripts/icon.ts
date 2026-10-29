import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import { monkeyBody } from "./monkey.ts";
import { palette } from "./palette.ts";
import { svg } from "./svg.ts";

const size = 512;
const scale = 1.55;
const shift = { x: -16, y: -50 };

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "..", "..", "plugin", ".claude-plugin", "icon.png");

function scene(): string {
  return (
    svg`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    svg`<defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.cardTop}"/><stop offset="1" stop-color="${palette.cardBottom}"/></linearGradient></defs>` +
    svg`<rect width="${size}" height="${size}" rx="96" fill="url(#wall)"/>` +
    svg`<g transform="translate(${shift.x} ${shift.y}) scale(${scale})">${monkeyBody({ mood: "pleased", beat: 0 })}</g>` +
    svg`</svg>`
  );
}

const png = new Resvg(scene(), { fitTo: { mode: "width", value: size } }).render().asPng();
writeFileSync(output, png);
process.stdout.write(`${output}: ${String(size)}x${String(size)}, ${String(Math.round(png.length / 1024))} KiB\n`);
