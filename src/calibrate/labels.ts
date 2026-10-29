import type { Runtime } from "../core/runtime.js";
import { dismissalTimes, taskOutcome } from "../evolve/outcome.js";
import { areasOf } from "../guardian/forecast.js";
import { commitsSince, overlaps, REVERT_WINDOW_DAYS } from "../guardian/outcomes.js";
import type { KnownTask } from "../guardian/tasks.js";
import type { FmPaths } from "../task/paths.js";

const DAY_MS = 86_400_000;

export interface Label {
  readonly task: string;
  readonly bad: boolean;
  readonly why: readonly ("false_done" | "reverted")[];
  readonly endMs: number;
  readonly areas: readonly string[];
}

type Commits = ReturnType<typeof commitsSince>;

const reverted = (commits: Commits, scope: readonly string[], endMs: number): boolean =>
  commits.some(
    (commit) =>
      commit.at >= endMs &&
      commit.at <= endMs + REVERT_WINDOW_DAYS * DAY_MS &&
      /^revert\b/i.test(commit.subject) &&
      commit.files.some((file) => scope.some((path) => overlaps(file, path))),
  );

export const labelsFor = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "exec">,
  paths: FmPaths,
  tasks: readonly KnownTask[],
): readonly Label[] => {
  const finished = tasks.filter((task) => task.done);
  if (finished.length === 0) return [];
  const dismissals = dismissalTimes(runtime, paths);
  const outcomes = finished.flatMap((task) => {
    const outcome = taskOutcome(runtime, paths, task.contract.id, dismissals);
    return outcome === undefined ? [] : [{ task, outcome }];
  });
  const earliest = Math.min(...outcomes.map((item) => item.outcome.startMs));
  const commits = outcomes.length === 0 ? [] : commitsSince(runtime, paths.root, new Date(earliest).toISOString());
  return outcomes.map(({ task, outcome }): Label => {
    const why = [
      ...(outcome.falseDone ? (["false_done"] as const) : []),
      ...(reverted(commits, task.contract.scope.paths, outcome.endMs) ? (["reverted"] as const) : []),
    ];
    return { task: outcome.task, bad: why.length > 0, why, endMs: outcome.endMs, areas: areasOf(task.contract) };
  });
};

export const areaHistory = (labels: readonly Label[], areas: readonly string[], beforeMs: number): number => {
  const wanted = new Set(areas);
  const prior = labels.filter((label) => label.endMs < beforeMs && label.areas.some((area) => wanted.has(area)));
  return prior.length === 0 ? 0 : prior.filter((label) => label.bad).length / prior.length;
};
