import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { GATE_CHECK } from "../evidence/types.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";

export const CLAIM_USE_FILE = "claim-use.jsonl";
export const USE_VIAS = ["retrieve", "inject"] as const;

export type UseVia = (typeof USE_VIAS)[number];

export interface ClaimUse {
  readonly at: string;
  readonly via: UseVia;
  readonly ids: readonly string[];
  readonly task?: string;
}

interface GreenRun {
  readonly task: string;
  readonly at: number;
}

export const claimUsePath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, CLAIM_USE_FILE));

export const CLAIM_ID = /^c-[0-9a-f]{8}$/;

export const recordClaimUse = (
  runtime: Pick<Runtime, "readText" | "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  via: UseVia,
  ids: readonly string[],
): void => {
  const kept = [...new Set(ids)].filter((id) => CLAIM_ID.test(id));
  if (kept.length === 0) return;
  const task = readState(runtime, paths).active;
  runtime.mkdir(paths.dir);
  runtime.appendText(
    claimUsePath(paths),
    `${JSON.stringify({ at: runtime.now(), via, ids: kept, ...(task === undefined ? {} : { task }) })}\n`,
  );
};

export const readClaimUse = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ClaimUse[] => {
  const text = runtime.readText(claimUsePath(paths));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line): readonly ClaimUse[] => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    if (parsed?.ok !== true) return [];
    const { at, via, ids, task } = parsed.value;
    const known = USE_VIAS.find((item) => item === via);
    if (typeof at !== "string" || known === undefined || !Array.isArray(ids)) return [];
    const list = ids.filter((id): id is string => typeof id === "string" && CLAIM_ID.test(id));
    return [{ at, via: known, ids: list, ...(typeof task === "string" && task !== "" ? { task } : {}) }];
  });
};

const greenRuns = (runtime: Pick<Runtime, "readText" | "homeDir" | "listDir">, paths: FmPaths): readonly GreenRun[] => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, "evidence")));
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".jsonl")) : [];
  return files.flatMap((name) =>
    readLedger(runtime, paths.evidence(name.replace(/\.jsonl$/, "")))
      .filter((entry) => entry.check === GATE_CHECK && entry.status === "passed")
      .map((entry) => ({ task: entry.task, at: Date.parse(entry.at) })),
  );
};

const endedGreen = (use: ClaimUse, runs: readonly GreenRun[]): boolean => {
  const at = Date.parse(use.at);
  return runs.some((run) => run.at > at && (use.task === undefined || run.task === use.task));
};

export const usedGreen = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "listDir">,
  paths: FmPaths,
): ReadonlySet<string> => {
  const uses = readClaimUse(runtime, paths);
  if (uses.length === 0) return new Set();
  const runs = greenRuns(runtime, paths);
  return new Set(uses.filter((use) => endedGreen(use, runs)).flatMap((use) => use.ids));
};
