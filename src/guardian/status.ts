import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { type Goals, readGoals } from "./goals.js";
import { type GuardianSignal, reopenedDecisions, scopeGrowth, stalledTasks, unlinkedTasks } from "./signals.js";
import { knownTasks } from "./tasks.js";

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

export const guardianStatus = (runtime: Pick<Runtime, "readText" | "listDir">, paths: FmPaths): GuardianStatus => {
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
    ],
  };
};
