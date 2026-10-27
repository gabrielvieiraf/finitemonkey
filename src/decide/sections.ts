import type { MessageKey } from "../i18n/catalogs.js";

export const DECISION_SECTIONS = [
  "short_answer",
  "question",
  "today",
  "criteria",
  "alternatives",
  "proof",
  "cost",
  "reversibility",
  "no_regret",
  "delta",
  "not_done",
  "risks",
  "to_prove",
  "limits",
  "plan_change",
  "status",
] as const;

export type DecisionSection = (typeof DECISION_SECTIONS)[number];

export const decisionKey = (id: DecisionSection): MessageKey => `decision.section.${id}`;

export const DECISION_SCHEMA = "finitemonkey/decision@1";

export const DECISION_STATUSES = ["proposed", "needs-person", "accepted", "revoked"] as const;

export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const QUESTION_LABELS = ["decision", "options", "recommendation", "cost", "risk"] as const;

export const questionKey = (label: (typeof QUESTION_LABELS)[number]): MessageKey => `decision.ask.${label}`;
