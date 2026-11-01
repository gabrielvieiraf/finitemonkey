import type { Runtime } from "../core/runtime.js";
import type { SourceHash } from "../evidence/types.js";
import type { FmPaths } from "../task/paths.js";
import { claimsIn, resultsIn } from "./claims.js";
import { readEntries } from "./store.js";
import type { JudgeEntry } from "./types.js";

export const judgeWanted = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): boolean =>
  resultsIn(readEntries(runtime, paths)).some((result) => result.task === task);

export const sourcesUsed = (entries: readonly JudgeEntry[], task: string): readonly SourceHash[] => {
  const results = resultsIn(entries).filter((result) => result.task === task);
  const used = new Set(results.flatMap((result) => result.claims));
  const anchors = claimsIn(entries)
    .filter((claim) => used.has(claim.id))
    .flatMap((claim) => claim.anchors.map((anchor) => ({ ref: anchor.ref, hash: anchor.hash })));
  const all = [...results.map((result) => ({ ref: result.source, hash: result.hash })), ...anchors];
  return [...new Map(all.map((item) => [`${item.ref}\u0000${item.hash}`, item])).values()];
};
