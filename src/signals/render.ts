import type { Translate } from "../i18n/translate.js";
import type { LoopIndex, Thresholds } from "./loop-index.js";

export const evidenceLines = (t: Translate, index: LoopIndex, thresholds: Thresholds): readonly string[] => [
  ...(index.error !== undefined && index.error.count >= Math.min(2, thresholds.errors)
    ? [t("signals.evidence.error", { sig: index.error.sig, count: index.error.count, sample: index.error.sample })]
    : []),
  ...(index.stalledTurns > 0 ? [t("signals.evidence.stalled", { count: index.stalledTurns })] : []),
  ...(index.repeatedPrompts > 0 ? [t("signals.evidence.prompts", { count: index.repeatedPrompts })] : []),
  ...(index.undoEdits > 0 ? [t("signals.evidence.undo", { count: index.undoEdits })] : []),
  ...(index.fastAccepts > 0 ? [t("signals.evidence.fast", { count: index.fastAccepts })] : []),
  ...(index.caughtAfterApproval > 0 ? [t("signals.evidence.caught", { count: index.caughtAfterApproval })] : []),
];

const byLine = (t: Translate, index: LoopIndex): string => {
  if (index.loopedBy === "model") return t("signals.by.model");
  if (index.loopedBy === "person") return t("signals.by.person");
  return "";
};

const frontierLine = (t: Translate, index: LoopIndex): string => {
  if (index.frontier === "exploration") return t("signals.frontier.exploration");
  if (index.frontier === "judgment") return t("signals.frontier.judgment");
  return "";
};

export const contextLine = (t: Translate, index: LoopIndex, thresholds: Thresholds): string =>
  [
    t("signals.context", { score: index.score.toFixed(2), evidence: evidenceLines(t, index, thresholds).join("; ") }),
    byLine(t, index),
    frontierLine(t, index),
  ]
    .filter((part) => part !== "")
    .join(" ");

export const pasteSummary = (t: Translate, index: LoopIndex, task: string | undefined): string =>
  [
    ...(task === undefined ? [] : [t("signals.summary.task", { task })]),
    ...(index.error === undefined
      ? []
      : [t("signals.summary.error", { sig: index.error.sig, count: index.error.count, sample: index.error.sample })]),
    ...(index.files.length === 0 ? [] : [t("signals.summary.files", { files: index.files.join(", ") })]),
    t("signals.summary.ask"),
  ].join(" ");
