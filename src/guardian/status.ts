import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { escalated, forecastFor } from "./forecast.js";
import { type Goals, readGoals } from "./goals.js";
import { type GuardianSignal, reopenedDecisions, scopeGrowth, stalledTasks, unlinkedTasks } from "./signals.js";
import { type KnownTask, knownTasks } from "./tasks.js";

export const GUARDIAN_STATUS_SCHEMA = "finitemonkey/guardian-status@1";

export interface GoalCounts {
  readonly stated: number;
  readonly inferred: number;
}

export interface GuardianStatus {
  readonly schema: typeof GUARDIAN_STATUS_SCHEMA;
  readonly goals: GoalCounts;
  readonly tasks: number;
  readonly signals: readonly GuardianSignal[];
}

const countGoals = (goals: Goals): GoalCounts => ({
  stated: goals.entries.filter((entry) => entry.origin === "stated").length,
  inferred: goals.entries.filter((entry) => entry.origin === "inferred").length,
});

const escalations = (
  runtime: Pick<Runtime, "readText" | "now" | "homeDir">,
  paths: FmPaths,
  tasks: readonly KnownTask[],
): readonly GuardianSignal[] =>
  tasks.flatMap((task) => {
    const elapsed = escalated(runtime, paths, task, forecastFor(runtime, paths, tasks, task.contract));
    return elapsed === undefined
      ? []
      : [{ kind: "escalation", subject: task.contract.id, detail: (elapsed / 3_600_000).toFixed(1) }];
  });

export const guardianStatus = (
  runtime: Pick<Runtime, "readText" | "listDir" | "now" | "homeDir">,
  paths: FmPaths,
): GuardianStatus => {
  const goals = readGoals(runtime, paths.root);
  const tasks = knownTasks(runtime, paths);
  return {
    schema: GUARDIAN_STATUS_SCHEMA,
    goals: countGoals(goals),
    tasks: tasks.length,
    signals: [
      ...unlinkedTasks(tasks, goals),
      ...scopeGrowth(tasks),
      ...reopenedDecisions(runtime, paths.root),
      ...stalledTasks(runtime, paths, tasks),
      ...escalations(runtime, paths, tasks),
    ],
  };
};
