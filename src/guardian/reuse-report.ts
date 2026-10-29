import type { Translate } from "../i18n/translate.js";
import type { ExistingMatch } from "./existing.js";
import { LEVEL_OF, type RealityReport } from "./report.js";

export const reuseReport = (t: Translate, match: ExistingMatch, goal: string): RealityReport => ({
  trigger: "reuse",
  level: LEVEL_OF.reuse,
  perceivedGoal: goal,
  request: match.added,
  finding: t("guardian.trigger.reuse.finding", { existing: match.existing, added: match.added }),
  evidence: [`${match.usage} (${match.role})`],
  assumptions: [],
  consequences: t("guardian.trigger.reuse.consequences"),
  alternatives: t("guardian.trigger.reuse.alternatives").split(" | "),
  recommendation: t("guardian.trigger.reuse.recommendation"),
  certainty: match.kind === "name" ? "low" : "medium",
  nextStep: t("guardian.trigger.reuse.next"),
  paths: [match.existing],
  key: `${match.added}\u0000${match.existing}`,
});
