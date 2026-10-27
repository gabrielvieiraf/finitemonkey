import type { YamlValue } from "../core/yaml/scalar.js";
import type { Translate } from "../i18n/translate.js";
import { writeFront } from "../plan/front.js";
import { table } from "../plan/markdown.js";
import {
  DECISION_SCHEMA,
  DECISION_SECTIONS,
  decisionKey,
  type DecisionSection,
  QUESTION_LABELS,
  questionKey,
} from "./sections.js";

const bodies = (t: Translate): Partial<Record<DecisionSection, readonly string[]>> => ({
  question: QUESTION_LABELS.map((label) => `- **${t(questionKey(label))}:**`),
  criteria: [
    t("decision.hint.criteria"),
    "",
    ...table([t("decision.col.criterion"), t("decision.col.weight"), t("decision.col.origin")], []),
  ],
  alternatives: table(
    [t("decision.col.alternative"), t("decision.col.score"), t("decision.col.notes")],
    [[t("decision.do_nothing"), "", ""]],
  ),
  delta: [`- ${t("decision.delta.added")}:`, `- ${t("decision.delta.modified")}:`, `- ${t("decision.delta.removed")}:`],
  status: ["proposed"],
});

export const renderDecision = (t: Translate, topic: string, date: string): string => {
  const filled = bodies(t);
  const front: YamlValue = { schema: DECISION_SCHEMA, topic, date, status: "proposed" };
  const body = [
    `# ${t("decision.title", { topic })}`,
    "",
    ...DECISION_SECTIONS.flatMap((id) => [`## ${t(decisionKey(id))}`, "", ...(filled[id] ?? []), ""]),
  ].join("\n");
  return writeFront(front, body);
};
