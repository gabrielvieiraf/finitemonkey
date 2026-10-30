import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { HandoffPackage } from "./response.js";
import { judgeDir } from "./store.js";
import { type ClaimEntry, JUDGE_SCHEMA, type JudgeEntry } from "./types.js";

export const HANDOFF_DIR = "handoffs";

export const handoffPath = (paths: FmPaths, claim: string): string =>
  join(judgeDir(paths), HANDOFF_DIR, `${claim}.json`);

const checkedOf = (claim: ClaimEntry, entries: readonly JudgeEntry[]): readonly string[] =>
  entries.flatMap((entry) =>
    entry.type === "support" && entry.claim === claim.id && entry.outcome !== undefined
      ? [`${entry.at} ${entry.outcome}`]
      : [],
  );

export const writeHandoff = (
  deps: { readonly runtime: Pick<Runtime, "mkdir" | "writeAtomic">; readonly paths: FmPaths },
  claim: ClaimEntry,
  entries: readonly JudgeEntry[],
  request: { readonly to: string; readonly missing: string },
  at: string,
): HandoffPackage => {
  const pack: HandoffPackage = {
    claim: claim.id,
    text: claim.text,
    sources: claim.anchors.map((anchor) => (anchor.span === undefined ? anchor.ref : `${anchor.ref} "${anchor.span}"`)),
    checked: checkedOf(claim, entries),
    missing: request.missing,
    to: request.to,
    at,
  };
  const path = toAbsolutePath(handoffPath(deps.paths, claim.id));
  deps.runtime.mkdir(toAbsolutePath(join(judgeDir(deps.paths), HANDOFF_DIR)));
  deps.runtime.writeAtomic(path, `${JSON.stringify({ schema: JUDGE_SCHEMA, ...pack }, null, 2)}\n`);
  return pack;
};
