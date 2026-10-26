import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { buildGif } from "./build.ts";
import { main, personaTargets } from "./targets.ts";

const maxBytes = 1_000_000;
const maxFrames = 120;

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const problems: string[] = [];
for (const target of [main, ...personaTargets]) {
  const id = target.persona.id;
  const first = buildGif(target.persona);
  const second = buildGif(target.persona);
  const digest = sha(first.gif);
  if (digest !== sha(second.gif)) problems.push(`${id}: two renders differ`);
  if (!existsSync(target.output)) problems.push(`${id}: ${target.output} is missing, run npm run gifs`);
  else if (sha(readFileSync(target.output)) !== digest) problems.push(`${id}: ${target.output} is stale, run npm run gifs`);
  if (target !== main && first.gif.length >= maxBytes)
    problems.push(`${id}: ${String(first.gif.length)} bytes, limit ${String(maxBytes)}`);
  if (target !== main && first.frames >= maxFrames)
    problems.push(`${id}: ${String(first.frames)} frames, limit ${String(maxFrames)}`);
  process.stdout.write(`${id}: ${String(first.frames)} frames, ${String(first.gif.length)} bytes, sha256 ${digest}\n`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
