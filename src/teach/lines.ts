import type { Probe } from "../conceitos/probes.js";
import type { Translate } from "../i18n/translate.js";
import type { QuestionView } from "./types.js";

export const questionLines = (t: Translate, view: QuestionView): readonly string[] => {
  const params = {
    id: view.question,
    concepts: view.concepts.join(", "),
    run: view.run,
    input: view.input === "" ? "-" : view.input,
  };
  if (!view.answered) return [t("teach.question", params), t("teach.answer_how", params)];
  return [
    t(view.correct === true ? "teach.result.same" : "teach.result.different", {
      ...params,
      actual: view.actual ?? "-",
    }),
  ];
};

export const probeLines = (t: Translate, probe: Probe): readonly string[] => [
  t("probe.card", { id: probe.id, question: probe.question }),
  ...probe.options.map((option) => t("probe.option", { id: option.id, text: option.text })),
  t("probe.why", { why: probe.why }),
  t("probe.answer_how", { id: probe.id }),
];
