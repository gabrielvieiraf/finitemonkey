import type { Translate } from "../i18n/translate.js";
import { taskRelative } from "../task/load.js";
import type { TaskContract } from "../task/types.js";
import type { Assumption } from "./assumptions.js";
import { type GoalEntry, type Goals, GOALS_FILE, statedGoals } from "./goals.js";
import type { IrreversibleStep } from "./irreversible.js";
import { LEVEL_OF, type RealityReport, type TriggerId } from "./report.js";
import { scopeGrowth } from "./signals.js";
import type { KnownTask } from "./tasks.js";

const words = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);

export const conflictsWith = (contract: TaskContract, entry: GoalEntry): boolean => {
  const wanted = words(entry.text);
  const have = new Set(words([contract.goal, ...contract.scope.paths].join(" ")));
  return wanted.length > 0 && wanted.every((word) => have.has(word));
};

interface Base {
  readonly t: Translate;
  readonly task: KnownTask;
  readonly goals: Goals;
  readonly open: readonly Assumption[];
}

const perceived = (base: Base): string => {
  const linked = statedGoals(base.goals).filter((goal) => base.task.goals.includes(goal.id));
  return linked.map((goal) => `${goal.id}: ${goal.text}`).join("; ") || base.task.contract.goal;
};

const reportFor = (
  base: Base,
  trigger: TriggerId,
  finding: string,
  evidence: readonly string[],
  paths: readonly string[],
  key: string,
): RealityReport => ({
  trigger,
  level: LEVEL_OF[trigger],
  perceivedGoal: perceived(base),
  request: base.task.contract.goal,
  finding,
  evidence,
  assumptions: base.open.map((item) => `${item.id}: ${item.text}`),
  consequences: base.t(`guardian.trigger.${trigger}.consequences`),
  alternatives: base.t(`guardian.trigger.${trigger}.alternatives`).split(" | "),
  recommendation: base.t(`guardian.trigger.${trigger}.recommendation`),
  certainty: trigger === "irreversible" ? "high" : "medium",
  nextStep: base.t(`guardian.trigger.${trigger}.next`),
  paths,
  key,
});

export const goalConflicts = (base: Base): readonly RealityReport[] =>
  base.goals.entries
    .filter((entry) => entry.origin === "stated" && (entry.kind === "non_goals" || entry.kind === "rejected"))
    .filter((entry) => conflictsWith(base.task.contract, entry))
    .map((entry) =>
      reportFor(
        base,
        "goal_conflict",
        base.t("guardian.trigger.goal_conflict.finding", { id: entry.id, kind: entry.kind, text: entry.text }),
        [
          `${GOALS_FILE}: ${entry.kind} ${entry.id} "${entry.text}"`,
          `${taskRelative(base.task.contract.id)}: goal "${base.task.contract.goal}"`,
        ],
        base.task.contract.scope.paths,
        entry.id,
      ),
    );

export const growthReports = (base: Base): readonly RealityReport[] =>
  scopeGrowth([base.task]).map((signal) =>
    reportFor(
      base,
      "scope_growth",
      base.t("guardian.trigger.scope_growth.finding", { detail: signal.detail }),
      [`${taskRelative(signal.subject)}: ${signal.detail}`],
      base.task.contract.scope.paths,
      signal.detail,
    ),
  );

export const irreversibleReport = (base: Base, step: IrreversibleStep): RealityReport =>
  reportFor(
    base,
    "irreversible",
    base.t("guardian.trigger.irreversible.finding", { kind: step.kind, target: step.target }),
    [step.target],
    [step.target],
    step.kind,
  );

export type TriggerBase = Base;
