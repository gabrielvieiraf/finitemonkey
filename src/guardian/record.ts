import { decisionKey, questionKey } from "../decide/sections.js";
import { catalogs } from "../i18n/catalogs.js";
import { LANGUAGES } from "../i18n/languages.js";
import { readFront } from "../plan/front.js";
import { matchesHeading, type Section, sectionsOf } from "../plan/sections.js";

export interface RecordFacts {
  readonly status: string;
  readonly recommendation: string;
  readonly facts: readonly string[];
  readonly assumptions: readonly string[];
  readonly paths: readonly string[];
}

const FACT = /^\s*(?:[-*|]\s*)?\**FACT\**\s*[:|]\s*(.+)$/;
const ASSUMPTION = /^\s*(?:[-*|]\s*)?\**ASSUMPTION\**\s*[:|]\s*(.+)$/;
const PATH = /(?:^|[\s`(])((?:[\w.-]+\/)+[\w.-]*|[\w-]+\.[a-z]{1,5})(?=$|[\s`),:;])/g;

const sectionText = (sections: readonly Section[], key: Parameters<typeof decisionKey>[0]): readonly string[] =>
  sections
    .filter((section) => matchesHeading(section.heading, decisionKey(key)))
    .flatMap((section) => section.lines.map((line) => line.text));

const firstLine = (lines: readonly string[]): string => lines.find((line) => line.trim() !== "")?.trim() ?? "";

const recommendationOf = (sections: readonly Section[]): string => {
  const names = LANGUAGES.map((lang) => catalogs[lang][questionKey("recommendation")].toLowerCase());
  const asked = sectionText(sections, "question").flatMap((text) => {
    const match = /^\s*[-*]?\s*\**([^:*]+?)\**\s*:\s*\**\s*(.*)$/.exec(text);
    const answer = (match?.[2] ?? "").replace(/\*/g, "").trim();
    return match !== null && names.includes((match[1] ?? "").trim().toLowerCase()) && answer !== "" ? [answer] : [];
  });
  return asked[0] ?? firstLine(sectionText(sections, "short_answer"));
};

const matches = (text: string, pattern: RegExp): readonly string[] =>
  text.split(/\r?\n/).flatMap((line) => {
    const match = pattern.exec(line);
    return match?.[1] === undefined ? [] : [match[1].trim()];
  });

const pathsIn = (lines: readonly string[]): readonly string[] =>
  [...new Set(lines.flatMap((line) => [...line.matchAll(PATH)].flatMap((match) => match[1] ?? [])))].filter(
    (path) => path.includes("/") || /\.[a-z]{1,5}$/.test(path),
  );

export const statusOf = (text: string): string => {
  const { data, body } = readFront(text);
  const front = typeof data?.["status"] === "string" ? data["status"] : "";
  const section = firstLine(sectionText(sectionsOf(body, 0), "status")).toLowerCase();
  return front === "accepted" || section === "accepted" ? "accepted" : front;
};

export const readRecord = (text: string): RecordFacts => {
  const { body } = readFront(text);
  const sections = sectionsOf(body, 0);
  return {
    status: statusOf(text),
    recommendation: recommendationOf(sections),
    facts: matches(text, FACT),
    assumptions: matches(text, ASSUMPTION),
    paths: pathsIn(sectionText(sections, "delta")),
  };
};
