import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { type IndexedFrame, patches } from "./diff.ts";
import { encodeGif } from "./gif.ts";
import type { Persona } from "./persona.ts";
import { histogram, Indexer, medianCut } from "./quantize.ts";
import { scene, width } from "./scene.ts";
import { buildTimeline } from "./timeline.ts";

export interface Built {
  readonly gif: Uint8Array;
  readonly frames: number;
}

const scale = 2;
const seed = 2026;
export const delay = 8;
const transparent = 0;
const sampleEvery = 6;

export function buildGif(persona: Persona, framesDir?: string): Built {
  if (framesDir !== undefined) mkdirSync(framesDir, { recursive: true });
  const timeline = buildTimeline(seed, persona.script);
  const rendered = timeline.map((_, index) => {
    const image = new Resvg(scene(persona, timeline, index), { fitTo: { mode: "width", value: width * scale } }).render();
    if (framesDir !== undefined)
      writeFileSync(join(framesDir, `frame-${String(index).padStart(3, "0")}.png`), image.asPng());
    return { pixels: new Uint8Array(image.pixels), width: image.width, height: image.height };
  });

  const first = rendered[0];
  if (first === undefined) throw new Error("timeline is empty");

  const palette = medianCut(
    histogram(rendered.filter((_, index) => index % sampleEvery === 0).map((frame) => frame.pixels)),
    255,
  );
  const indexer = new Indexer(palette, 1);

  const indexed: IndexedFrame[] = rendered.map(({ pixels }) => {
    const indices = new Uint8Array(pixels.length / 4);
    for (let pixel = 0; pixel < indices.length; pixel += 1) {
      const offset = pixel * 4;
      indices[pixel] =
        (pixels[offset + 3] ?? 0) < 128
          ? transparent
          : indexer.index(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0);
    }
    return { indices, delay };
  });

  const gif = encodeGif({
    width: first.width,
    height: first.height,
    palette: [[0, 0, 0], ...palette],
    transparent,
    patches: patches(indexed, first.width, first.height, transparent),
  });
  return { gif, frames: rendered.length };
}
