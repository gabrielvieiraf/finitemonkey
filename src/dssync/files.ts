import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { Snapshot } from "./summary.js";

export const snapshotOf = (runtime: Pick<Runtime, "walkFiles" | "readText">, dir: AbsolutePath): Snapshot => {
  const files = runtime.walkFiles(dir);
  if (!files.ok) return new Map();
  return new Map(
    files.value.flatMap((file): [string, string][] => {
      const text = runtime.readText(toAbsolutePath(join(dir, file)));
      return text.ok ? [[file, text.value]] : [];
    }),
  );
};

export const mirror = (runtime: Runtime, from: AbsolutePath, to: AbsolutePath): number => {
  const source = runtime.walkFiles(from);
  const target = runtime.walkFiles(to);
  const wanted = new Set(source.ok ? source.value : []);
  let changed = 0;
  for (const file of wanted) {
    const destination = toAbsolutePath(join(to, file));
    runtime.mkdir(toAbsolutePath(dirname(destination)));
    if (runtime.copyFile(toAbsolutePath(join(from, file)), destination).ok) changed += 1;
  }
  for (const file of target.ok ? target.value : []) {
    if (!wanted.has(file) && runtime.remove(toAbsolutePath(join(to, file))).ok) changed += 1;
  }
  return changed;
};
