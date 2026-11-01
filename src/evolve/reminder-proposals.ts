import type { Runtime } from "../core/runtime.js";
import { logEntries } from "../knowledge/instruction-arms.js";
import { excludedReminders } from "../policy/evolved.js";
import type { Policy } from "../policy/policy.js";
import { reminderRules } from "../reminders/select.js";
import { effectiveRules } from "../rules/preset.js";
import { readSummary } from "../rules/violations.js";
import type { FmPaths } from "../task/paths.js";
import type { Proposal } from "./propose.js";

export const REMINDER_EVENTS: readonly string[] = ["reminder_injected", "reminder_shadow"];

export const reminderInjections = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const entry of logEntries(runtime, paths, REMINDER_EVENTS)) {
    const rules = entry["rules"];
    if (typeof rules !== "string") continue;
    for (const rule of rules.split(",").filter((id) => id !== "")) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return counts;
};

export const reminderProposals = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  policy: Policy,
): readonly Proposal[] => {
  const rules = effectiveRules(runtime, paths.root);
  if (!rules.ok) return [];
  const violations = readSummary(runtime, paths.dir).counts;
  const injected = reminderInjections(runtime, paths);
  const excluded = excludedReminders(policy);
  return reminderRules(rules.value).flatMap((rule): Proposal[] => {
    const times = injected.get(rule.id) ?? 0;
    if (excluded.has(rule.id) || times < policy.alertBudget.minFirings || (violations[rule.id] ?? 0) > 0) return [];
    return [
      {
        change: { kind: "reminder", rule: rule.id, include: false },
        reason: `injected ${String(times)} times, never violated`,
      },
    ];
  });
};
