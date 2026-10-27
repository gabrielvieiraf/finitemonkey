import { catalogs, type MessageKey } from "../i18n/catalogs.js";
import { LANGUAGES } from "../i18n/languages.js";

export const MASTER_SECTIONS = [
  "goal",
  "decisions",
  "responsibilities",
  "numbers",
  "risks",
  "questions",
  "reports",
] as const;

export type MasterSection = (typeof MASTER_SECTIONS)[number];

export const SECTION_KEYS: Readonly<Record<MasterSection, MessageKey>> = {
  goal: "plan.section.goal",
  decisions: "plan.section.decisions",
  responsibilities: "plan.section.responsibilities",
  numbers: "plan.section.numbers",
  risks: "plan.section.risks",
  questions: "plan.section.questions",
  reports: "plan.section.reports",
};

export const headingsOf = (key: MessageKey): readonly string[] =>
  LANGUAGES.map((lang) => catalogs[lang][key].trim().toLowerCase());

export const matchesHeading = (heading: string, key: MessageKey): boolean =>
  headingsOf(key).includes(heading.trim().toLowerCase());

export interface Section {
  readonly heading: string;
  readonly line: number;
  readonly lines: readonly { readonly text: string; readonly line: number }[];
}

const HEADING = /^##\s+(.+?)\s*#*\s*$/;

export const sectionsOf = (body: string, offset = 0): readonly Section[] => {
  const sections: { heading: string; line: number; lines: { text: string; line: number }[] }[] = [];
  body.split("\n").forEach((raw, index) => {
    const text = raw.replace(/\r$/, "");
    const heading = HEADING.exec(text)?.[1];
    if (heading !== undefined) sections.push({ heading, line: index + 1 + offset, lines: [] });
    else sections.at(-1)?.lines.push({ text, line: index + 1 + offset });
  });
  return sections;
};

export const sectionOf = (sections: readonly Section[], key: MessageKey): Section | undefined =>
  sections.find((section) => matchesHeading(section.heading, key));

export const masterSectionOf = (heading: string): MasterSection | undefined =>
  MASTER_SECTIONS.find((id) => matchesHeading(heading, SECTION_KEYS[id]));
