import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Arm } from "./bench-arms.js";
import { type Freeze, PREREGISTRATION_LOCK } from "./bench-prereg.js";

export type Git = (args: readonly string[]) => string | undefined;

export interface PilotState {
  readonly tag: string;
  readonly tagCommit: string | undefined;
  readonly lockAtTag: string | undefined;
  readonly lock: string;
  readonly freeze: Freeze;
  readonly arms: readonly Arm[];
}

export const preregTag = (freeze: Pick<Freeze, "frozenAt">): string => `bench-prereg-${freeze.frozenAt}`;

export const realGit =
  (cwd: string): Git =>
  (args) => {
    const run = spawnSync("git", [...args], { cwd, encoding: "utf8" });
    return run.status === 0 ? run.stdout.trim() : undefined;
  };

export const readPilotState = (benchDir: string, freeze: Freeze, arms: readonly Arm[], git: Git): PilotState => {
  const tag = preregTag(freeze);
  const tagCommit = git(["rev-list", "-n", "1", `refs/tags/${tag}`]);
  return {
    tag,
    tagCommit: tagCommit === "" ? undefined : tagCommit,
    lockAtTag: tagCommit === undefined ? undefined : git(["show", `${tag}:bench/${PREREGISTRATION_LOCK}`]),
    lock: readFileSync(join(benchDir, PREREGISTRATION_LOCK), "utf8").trim(),
    freeze,
    arms,
  };
};

export const pilotProblems = (state: PilotState): readonly string[] => [
  ...(state.tagCommit === undefined
    ? [`the pre-registration tag ${state.tag} does not exist; tag the freeze commit before the pilot`]
    : []),
  ...(state.tagCommit !== undefined && state.lockAtTag?.trim() !== state.lock
    ? [`${state.tag} does not point at a commit with the current ${PREREGISTRATION_LOCK}; re-tag after the freeze`]
    : []),
  ...state.arms
    .filter((arm) => arm.finitemonkey && (arm.sha ?? "") === "")
    .map((arm) => `arm ${arm.id} has no pinned sha; pin it in the freeze commit`),
];

export const pilotChecklist = (state: PilotState): readonly string[] => [
  `pre-registration ${state.freeze.sha256} frozen ${state.freeze.frozenAt}`,
  `tag ${state.tag}: ${state.tagCommit ?? "missing"}`,
  ...state.arms.map((arm) => `arm ${arm.id}: ${arm.finitemonkey ? (arm.sha ?? "unpinned") : "no plugin"}`),
  ...Object.entries(state.freeze.personas)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, hash]) => `persona ${file}: ${hash}`),
];
