import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { DECISION_FILE } from "../decide/check.js";
import { readLedger } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import type { FmPaths } from "../task/paths.js";
import { SIZES } from "../task/types.js";
import { type GoalEntry, type Goals, statedGoals } from "./goals.js";
import type { KnownTask } from "./tasks.js";

export const SIGNAL_KINDS = ["unlinked_task", "scope_growth", "reopened_decision", "stalled", "escalation"] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

export interface GuardianSignal {
  readonly kind: SignalKind;
  readonly subject: string;
  readonly detail: string;
}

export const STALLED_DAYS = 3;

export const unlinkedTasks = (tasks: readonly KnownTask[], goals: Goals): readonly GuardianSignal[] => {
  const stated = new Set(statedGoals(goals).map((entry: GoalEntry) => entry.id));
  return tasks
    .filter((task) => !task.done && !task.goals.some((id) => stated.has(id)))
    .map((task) => ({
      kind: "unlinked_task",
      subject: task.contract.id,
      detail: task.goals.length === 0 ? "-" : task.goals.join(", "),
    }));
};

const grownPaths = (task: KnownTask): readonly string[] => {
  const before = new Set(task.approved?.scope.paths ?? []);
  return task.contract.scope.paths.filter((path) => !before.has(path));
};

export const scopeGrowth = (tasks: readonly KnownTask[]): readonly GuardianSignal[] =>
  tasks.flatMap((task) => {
    const approved = task.approved;
    if (approved === undefined) return [];
    const added = grownPaths(task);
    const bigger = SIZES.indexOf(task.contract.size) > SIZES.indexOf(approved.size);
    const budget = (task.contract.scope.diffBudget?.lines ?? 0) > (approved.scope.diffBudget?.lines ?? 0);
    const parts = [
      ...(added.length === 0 ? [] : [`+${added.join(", +")}`]),
      ...(bigger ? [`size ${approved.size} -> ${task.contract.size}`] : []),
      ...(budget && approved.scope.diffBudget?.lines !== undefined ? ["diff budget raised"] : []),
    ];
    return parts.length === 0 ? [] : [{ kind: "scope_growth", subject: task.contract.id, detail: parts.join("; ") }];
  });

const FACT = /^\s*(?:[-*|]\s*)?\**FACT\**\s*[:|]\s*(.+)$/;

export const factsIn = (text: string): ReadonlySet<string> =>
  new Set(
    text.split(/\r?\n/).flatMap((line) => {
      const match = FACT.exec(line);
      return match?.[1] === undefined ? [] : [match[1].replace(/\s+/g, " ").trim().toLowerCase()];
    }),
  );

const topicOf = (name: string): string => name.replace(/^\d+[a-z]?-decision-/, "").replace(/\.md$/, "");

export const reopenedDecisions = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  root: AbsolutePath,
): readonly GuardianSignal[] => {
  const seen = new Map<string, { readonly file: string; readonly facts: Set<string> }>();
  return planFiles(runtime, root)
    .filter((name) => DECISION_FILE.test(name))
    .flatMap((name) => {
      const text = runtime.readText(planPath(root, name));
      if (!text.ok) return [];
      const facts = factsIn(text.value);
      const topic = topicOf(name);
      const earlier = seen.get(topic);
      if (earlier === undefined) {
        seen.set(topic, { file: name, facts: new Set(facts) });
        return [];
      }
      const fresh = [...facts].filter((fact) => !earlier.facts.has(fact));
      for (const fact of facts) earlier.facts.add(fact);
      return fresh.length > 0
        ? []
        : [{ kind: "reopened_decision", subject: `${PLAN_DIR}/${name}`, detail: `${PLAN_DIR}/${earlier.file}` }];
    });
};

const day = (entry: Evidence): string => entry.at.slice(0, 10);

export const almostDone = (ledger: readonly Evidence[]): boolean => {
  const gates = ledger.filter((entry) => entry.check === GATE_CHECK);
  const last = gates.at(-1);
  if (last?.status !== "failed") return false;
  const failing = new Set(
    ledger
      .filter((entry) => entry.check !== GATE_CHECK && entry.treeHash === last.treeHash)
      .filter((entry, index, all) => all.findLastIndex((other) => other.check === entry.check) === index)
      .filter((entry) => entry.status === "failed")
      .map((entry) => entry.check),
  );
  return failing.size <= 1;
};

export const failingDays = (ledger: readonly Evidence[]): number => {
  const gates = ledger.filter((entry) => entry.check === GATE_CHECK);
  const lastPass = gates.findLastIndex((entry) => entry.status === "passed");
  return new Set(
    gates
      .slice(lastPass + 1)
      .filter((entry) => entry.status === "failed")
      .map(day),
  ).size;
};

export const stalledTasks = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  tasks: readonly KnownTask[],
): readonly GuardianSignal[] =>
  tasks.flatMap((task) => {
    if (task.done) return [];
    const ledger = readLedger(runtime, paths.evidence(task.contract.id));
    const days = failingDays(ledger);
    return days >= STALLED_DAYS && almostDone(ledger)
      ? [{ kind: "stalled", subject: task.contract.id, detail: String(days) }]
      : [];
  });
