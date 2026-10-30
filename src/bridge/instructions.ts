import type { Runtime } from "../core/runtime.js";
import { featureMode } from "../policy/feature.js";
import { limitsOf } from "../reminders/hooks.js";
import { selectReminders } from "../reminders/select.js";
import { effectiveRules } from "../rules/preset.js";
import type { FmPaths } from "../task/paths.js";

export const RULES_FEATURE = "reminders";

export const rulesSection = (runtime: Runtime, paths: FmPaths): string => {
  if (featureMode(runtime, paths, RULES_FEATURE) !== "active") return "";
  const rules = effectiveRules(runtime, paths.root);
  if (!rules.ok) return "";
  return selectReminders(
    rules.value,
    { kind: "session", source: "startup" },
    {
      counts: {},
      pending: [],
      seen: new Set(),
      limits: limitsOf(runtime, paths.root),
    },
  ).text;
};
