import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { type Arm, experimentArm } from "../policy/experiment.js";
import type { GuardMode } from "../policy/policy.js";
import { loadPolicy } from "../policy/policy.js";
import { IMPLICIT_ID } from "../task/implicit.js";
import { activeTaskId } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import type { UiScreen } from "./contract.js";
import { LOOK_DIR, lookDir } from "./paths.js";
import type { ProbeBox } from "./probe.js";

export const CRITIC_FEATURE = "ui-critic";
export const CRITIQUE_FILE = "critique.json";
export const PAIRS_FILE = "pairs.json";
export const MAX_CRITIQUES = 5;
export const CHECKLIST = [
  "N1-status",
  "N2-real-world",
  "N3-control",
  "N4-consistency",
  "N5-error-prevention",
  "N6-recognition",
  "N7-efficiency",
  "N8-minimal",
  "N9-error-recovery",
  "N10-help",
] as const;

export type ChecklistId = (typeof CHECKLIST)[number];

export interface CritiqueInput {
  readonly route: string;
  readonly viewport: number;
  readonly screenshot: string;
  readonly contract: readonly UiScreen[];
  readonly tokens: readonly string[];
}

export interface RawCritique {
  readonly heuristic?: unknown;
  readonly region?: unknown;
  readonly text?: unknown;
}

export interface Critique {
  readonly route: string;
  readonly viewport: number;
  readonly heuristic: ChecklistId;
  readonly region: ProbeBox;
  readonly text: string;
}

export interface Critic {
  readonly critique: (input: CritiqueInput) => Promise<readonly RawCritique[]>;
  readonly rank: (a: string, b: string, checklist: readonly string[]) => Promise<"a" | "b">;
}

const boxOf = (value: unknown): ProbeBox | undefined => {
  if (!isRecord(value)) return undefined;
  const { x, y, w, h } = value;
  return typeof x === "number" &&
    typeof y === "number" &&
    typeof w === "number" &&
    typeof h === "number" &&
    w > 0 &&
    h > 0
    ? { x, y, w, h }
    : undefined;
};

export const keepValid = (input: CritiqueInput, raw: readonly RawCritique[]): readonly Critique[] =>
  raw
    .flatMap((item) => {
      const heuristic = CHECKLIST.find((id) => id === item.heuristic);
      const region = boxOf(item.region);
      if (heuristic === undefined || region === undefined) return [];
      return [
        {
          route: input.route,
          viewport: input.viewport,
          heuristic,
          region,
          text: typeof item.text === "string" ? item.text.slice(0, 300) : "",
        },
      ];
    })
    .slice(0, MAX_CRITIQUES);

export const critiquePath = (paths: FmPaths, tree: string): AbsolutePath =>
  toAbsolutePath(join(lookDir(paths, tree), CRITIQUE_FILE));

export interface CritiqueFile {
  readonly schema: "finitemonkey/look-critique@1";
  readonly tree: string;
  readonly mode: GuardMode;
  readonly arm: Arm | "none";
  readonly critiques: readonly Critique[];
}

export const readCritique = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  tree: string,
): CritiqueFile | undefined => {
  const raw = runtime.readText(critiquePath(paths, tree));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  if (parsed?.ok !== true) return undefined;
  const list = parsed.value["critiques"];
  const mode = parsed.value["mode"];
  const arm = parsed.value["arm"];
  return {
    schema: "finitemonkey/look-critique@1",
    tree,
    mode: mode === "active" || mode === "shadow" ? mode : "off",
    arm: arm === "active" || arm === "off" ? arm : "none",
    critiques: Array.isArray(list)
      ? list.flatMap((item: unknown) => {
          if (!isRecord(item) || typeof item["route"] !== "string" || typeof item["viewport"] !== "number") return [];
          return keepValid(
            { route: item["route"], viewport: item["viewport"], screenshot: "", contract: [], tokens: [] },
            [item],
          );
        })
      : [],
  };
};

export interface CriticRun {
  readonly runtime: Runtime;
  readonly paths: FmPaths;
  readonly tree: string;
  readonly mode: GuardMode;
  readonly critic: Critic | undefined;
  readonly inputs: readonly CritiqueInput[];
}

export const runCritic = async (run: CriticRun): Promise<CritiqueFile | undefined> => {
  if (run.mode === "off" || run.critic === undefined) return undefined;
  const existing = readCritique(run.runtime, run.paths, run.tree);
  if (existing !== undefined) return existing;
  const policy = loadPolicy(run.runtime, run.paths.root);
  const arm = experimentArm(run.runtime, run.paths, policy, CRITIC_FEATURE);
  const task = activeTaskId(run.runtime, run.paths) ?? IMPLICIT_ID;
  const critiques: Critique[] = [];
  if (arm !== "off")
    for (const input of run.inputs) critiques.push(...keepValid(input, await run.critic.critique(input)));
  const file: CritiqueFile = {
    schema: "finitemonkey/look-critique@1",
    tree: run.tree,
    mode: run.mode,
    arm: arm ?? "none",
    critiques: critiques.slice(0, MAX_CRITIQUES),
  };
  run.runtime.writeText(critiquePath(run.paths, run.tree), `${JSON.stringify(file, null, 2)}\n`);
  logEvent(run.runtime, run.paths, "ui_critic", {
    task,
    arm: arm ?? "none",
    mode: run.mode,
    critiques: file.critiques.length,
  });
  return file;
};

export interface Pair {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly checklist: readonly string[];
  readonly critic: "a" | "b";
  readonly person: "a" | "b" | null;
  readonly at: string;
}

export const pairsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, LOOK_DIR, PAIRS_FILE));

const pairOf = (value: unknown): Pair | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, a, b, critic, person, at } = value;
  if (typeof id !== "string" || typeof a !== "string" || typeof b !== "string" || typeof at !== "string")
    return undefined;
  if (critic !== "a" && critic !== "b") return undefined;
  const checklist = Array.isArray(value["checklist"])
    ? value["checklist"].filter((item): item is string => typeof item === "string")
    : [];
  return { id, a, b, checklist, critic, person: person === "a" || person === "b" ? person : null, at };
};

export const readPairs = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Pair[] => {
  const raw = runtime.readText(pairsPath(paths));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const list = parsed?.ok === true ? parsed.value["pairs"] : undefined;
  return Array.isArray(list) ? list.flatMap((item: unknown) => pairOf(item) ?? []) : [];
};

export const writePairs = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, pairs: readonly Pair[]): boolean =>
  runtime.writeText(pairsPath(paths), `${JSON.stringify({ pairs }, null, 2)}\n`).ok;

export const agreement = (pairs: readonly Pair[]): { readonly decided: number; readonly agreed: number } => {
  const decided = pairs.filter((pair) => pair.person !== null);
  return { decided: decided.length, agreed: decided.filter((pair) => pair.person === pair.critic).length };
};

export const rankPair = async (
  runtime: Pick<Runtime, "readText" | "writeText" | "now" | "appendText">,
  paths: FmPaths,
  critic: Critic,
  pair: { readonly a: string; readonly b: string; readonly checklist: readonly string[] },
): Promise<Pair> => {
  const pairs = readPairs(runtime, paths);
  const made: Pair = {
    id: `P${String(pairs.length + 1)}`,
    a: pair.a,
    b: pair.b,
    checklist: pair.checklist,
    critic: await critic.rank(pair.a, pair.b, pair.checklist),
    person: null,
    at: runtime.now(),
  };
  writePairs(runtime, paths, [...pairs, made]);
  logEvent(runtime, paths, "ui_critic_rank", { id: made.id, critic: made.critic });
  return made;
};
