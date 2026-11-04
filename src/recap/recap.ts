import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { readEvidence } from "../gain/gain.js";
import { featureMode } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import { readUnits } from "../stale/docs.js";
import { resolveUnits, type StaleClaim } from "../stale/resolve.js";
import { type CommandEntry, localState } from "../stale/state.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import {
  type FinishedTask,
  finishedTasks,
  type PeriodCommit,
  periodCommits,
  type RecordedDecision,
  recordedDecisions,
} from "./sources.js";

export const RECAP_SCHEMA = "finitemonkey/recap@1";
export const SHIPPED_TYPES: ReadonlySet<string> = new Set(["feat", "fix", "perf"]);

export interface FeatureState {
  readonly id: string;
  readonly mode: GuardMode;
}

export interface ShippedChange {
  readonly sha: string;
  readonly type: string;
  readonly subject: string;
  readonly features: readonly FeatureState[];
}

export interface RecapReport {
  readonly schema: typeof RECAP_SCHEMA;
  readonly since: string;
  readonly until: string;
  readonly commits: number;
  readonly tasksFinished: readonly FinishedTask[];
  readonly shipped: readonly ShippedChange[];
  readonly decisions: readonly RecordedDecision[];
  readonly activeTask: string | null;
  readonly inShadow: readonly string[];
  readonly staleDocs: readonly StaleClaim[];
}

type RecapRuntime = Pick<Runtime, "git" | "readText" | "exec" | "listDir" | "homeDir" | "now">;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const featuresOf = (commit: PeriodCommit, ids: readonly string[]): readonly string[] => {
  const text = `${commit.subject}\n${commit.body}`;
  return ids.filter(
    (id) =>
      commit.scope === id ||
      new RegExp(`\`${escape(id)}\``).test(text) ||
      (id.includes("-") && new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`).test(text)),
  );
};

const shippedOf = (
  runtime: RecapRuntime,
  paths: FmPaths,
  commits: readonly PeriodCommit[],
  ids: readonly string[],
): readonly ShippedChange[] =>
  commits
    .filter((commit) => SHIPPED_TYPES.has(commit.type))
    .map((commit) => ({
      sha: commit.sha,
      type: commit.type,
      subject: commit.subject,
      features: featuresOf(commit, ids).map((id) => ({ id, mode: featureMode(runtime, paths, id) })),
    }));

export const buildRecap = (
  runtime: RecapRuntime,
  root: AbsolutePath,
  paths: FmPaths,
  registry: readonly CommandEntry[],
  since: string,
): RecapReport => {
  const state = localState(runtime, root, registry, undefined);
  const commits = periodCommits(runtime, root, since);
  const shipped = shippedOf(runtime, paths, commits, [...state.features.keys()]);
  const inShadow = [
    ...new Set(shipped.flatMap((item) => item.features.filter((f) => f.mode === "shadow").map((f) => f.id))),
  ].sort();
  return {
    schema: RECAP_SCHEMA,
    since,
    until: runtime.now(),
    commits: commits.length,
    tasksFinished: finishedTasks(readEvidence(runtime, paths), since),
    shipped,
    decisions: recordedDecisions(runtime, paths, since),
    activeTask: readState(runtime, paths).active ?? null,
    inShadow,
    staleDocs: resolveUnits(readUnits(runtime, root), state).stale,
  };
};
