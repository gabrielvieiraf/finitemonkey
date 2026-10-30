import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const work = process.env.ORACLE_WORKDIR ?? "";
const base = process.env.ORACLE_BASE ?? "";
export const vars = JSON.parse(process.env.ORACLE_VARS ?? "{}");
const requireFrom = createRequire(join(work, "oracle-entry.js"));
export const load = (path) => {
  const resolved = requireFrom.resolve(join(work, path));
  delete requireFrom.cache[resolved];
  return requireFrom(resolved);
};
export const read = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined);
export const inWork = (path) => read(work, path);
export const inBase = (path) => read(base, path);
export const random = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
