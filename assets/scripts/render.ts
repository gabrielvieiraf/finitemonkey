import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildGif, delay } from "./build.ts";
import { selectTargets } from "./targets.ts";

const framesDir = process.env.FRAMES_DIR;
const targets = selectTargets(process.argv.slice(2));

for (const target of targets) {
  const dir = framesDir === undefined ? undefined : targets.length > 1 ? join(framesDir, target.persona.id) : framesDir;
  const { gif, frames } = buildGif(target.persona, dir);
  mkdirSync(dirname(target.output), { recursive: true });
  writeFileSync(target.output, gif);
  const kib = Math.round(gif.length / 1024);
  process.stdout.write(
    `${target.output}: ${String(frames)} frames, ${String(100 / delay)} fps, ${String(gif.length)} bytes, ${String(kib)} KiB\n`,
  );
}
