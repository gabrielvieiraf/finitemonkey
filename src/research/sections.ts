import type { MessageKey } from "../i18n/catalogs.js";

export const RESEARCH_SCHEMA = "finitemonkey/research@1";

export const RESEARCH_SECTIONS = [
  "not_read",
  "not_verified",
  "question",
  "unlocks",
  "sources",
  "findings",
  "versions",
  "plan_text",
] as const;

export type ResearchSection = (typeof RESEARCH_SECTIONS)[number];

export const researchKey = (id: ResearchSection): MessageKey =>
  id === "plan_text" ? "plan.text_for_plan" : `research.section.${id}`;

export const SOURCE_KINDS = ["primary", "secondary", "vendor", "index"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const STRENGTHS = ["strong", "medium", "weak"] as const;

export const RESEARCH_FILE = /^\d{2,}[a-z]?-state-of-the-art-.+\.md$/;
