import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { catalogs, type MessageKey } from "../i18n/catalogs.js";
import { LANGUAGES } from "../i18n/languages.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import { readFront } from "../plan/front.js";
import { matchesHeading, type Section, sectionsOf } from "../plan/sections.js";
import {
  DECISION_SECTIONS,
  DECISION_STATUSES,
  decisionKey,
  type DecisionSection,
  QUESTION_LABELS,
  questionKey,
} from "./sections.js";

export const DECISION_ISSUES = [
  "missing_sections",
  "order",
  "fact_without_source",
  "no_do_nothing",
  "criteria_incomplete",
  "removal_without_parity",
  "question_incomplete",
  "unknown_status",
] as const;

export type DecisionIssueKind = (typeof DECISION_ISSUES)[number];

export interface DecisionIssue {
  readonly kind: DecisionIssueKind;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export const DECISION_FILE = /^\d{2,}-decision-.+\.md$/;

const FACT = /^\s*(?:[-*|]\s*)?\**FACT\**\s*[:|]/;
const SOURCE = /https?:\/\/\S+|[\w./-]*[A-Za-z_/-][\w./-]*\.[A-Za-z]{1,6}(?::\d+)?\b|\bsource\s*:\s*\S/i;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const PARITY = /parity|\bP\d+\b/i;

const anyLang = (key: MessageKey): readonly string[] => LANGUAGES.map((lang) => catalogs[lang][key].toLowerCase());

const idOf = (section: Section): DecisionSection | undefined =>
  DECISION_SECTIONS.find((id) => matchesHeading(section.heading, decisionKey(id)));

type Issue = Omit<DecisionIssue, "file">;

const structureIssues = (sections: readonly Section[]): readonly Issue[] => {
  const ids = sections.flatMap((section) => idOf(section) ?? []);
  const missing = DECISION_SECTIONS.filter((id) => !ids.includes(id));
  const ordered = ids.every(
    (id, index) => index === 0 || DECISION_SECTIONS.indexOf(id) > DECISION_SECTIONS.indexOf(ids[index - 1] ?? id),
  );
  return [
    ...(missing.length === 0
      ? []
      : [
          {
            kind: "missing_sections" as const,
            line: 1,
            detail: missing.map((id) => catalogs.en[decisionKey(id)]).join(", "),
          },
        ]),
    ...(ordered ? [] : [{ kind: "order" as const, line: sections[0]?.line ?? 1, detail: ids.join(", ") }]),
  ];
};

const linesOf = (sections: readonly Section[], id: DecisionSection): Section["lines"] =>
  sections.find((section) => idOf(section) === id)?.lines ?? [];

const factIssues = (sections: readonly Section[]): readonly Issue[] =>
  sections
    .flatMap((section) => section.lines)
    .filter((line) => FACT.test(line.text) && !(SOURCE.test(line.text.replace(FACT, "")) && DATE.test(line.text)))
    .map((line) => ({ kind: "fact_without_source", line: line.line, detail: line.text.trim() }));

const rowsOf = (lines: Section["lines"]): readonly (readonly string[])[] =>
  lines
    .filter((line) => line.text.trim().startsWith("|"))
    .slice(1)
    .map((line) =>
      line.text
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !/^-{3}/.test(cells[0] ?? ""));

const contentIssues = (sections: readonly Section[]): readonly Issue[] => {
  const alternatives = linesOf(sections, "alternatives")
    .map((line) => line.text.toLowerCase())
    .join("\n");
  const criteria = rowsOf(linesOf(sections, "criteria"));
  const removed = anyLang("decision.delta.removed");
  const removals = linesOf(sections, "delta").filter((line) => {
    const match = /^\s*[-*]\s*([^:]+):\s*(\S.*)$/.exec(line.text);
    return match !== null && removed.includes((match[1] ?? "").trim().toLowerCase()) && !PARITY.test(match[2] ?? "");
  });
  const head = sections[0]?.line ?? 1;
  return [
    ...(anyLang("decision.do_nothing").some((text) => alternatives.includes(text))
      ? []
      : [{ kind: "no_do_nothing" as const, line: head, detail: catalogs.en["decision.do_nothing"] }]),
    ...(criteria.length > 0 &&
    criteria.every((cells) => cells.length >= 3 && cells.slice(0, 3).every((cell) => cell !== ""))
      ? []
      : [{ kind: "criteria_incomplete" as const, line: head, detail: String(criteria.length) }]),
    ...removals.map((line) => ({ kind: "removal_without_parity" as const, line: line.line, detail: line.text.trim() })),
  ];
};

const questionIssues = (sections: readonly Section[], status: string): readonly Issue[] => {
  if (status !== "needs-person") return [];
  const lines = linesOf(sections, "question").map((line) => line.text);
  const missing = QUESTION_LABELS.filter((label) => {
    const names = anyLang(questionKey(label));
    return !lines.some((text) => {
      const match = /^\s*[-*]?\s*\**([^:*]+?)\**\s*:(.*)$/.exec(text);
      const answer = (match?.[2] ?? "").replace(/\*/g, "").trim();
      return match !== null && names.includes((match[1] ?? "").trim().toLowerCase()) && answer !== "";
    });
  });
  return missing.length === 0
    ? []
    : [{ kind: "question_incomplete", line: sections[0]?.line ?? 1, detail: missing.join(", ") }];
};

export const checkDecisionText = (file: string, text: string): readonly DecisionIssue[] => {
  const { data, body } = readFront(text);
  const offset = text.replace(/\r\n/g, "\n").split("\n").length - body.split("\n").length;
  const sections = sectionsOf(body, offset);
  const status = typeof data?.["status"] === "string" ? data["status"] : "";
  const known = DECISION_STATUSES.some((item) => item === status);
  if (status === "revoked") return [];
  return [
    ...(known ? [] : [{ kind: "unknown_status" as const, line: 1, detail: status }]),
    ...structureIssues(sections),
    ...factIssues(sections),
    ...contentIssues(sections),
    ...questionIssues(sections, status),
  ].map((item) => ({ ...item, file }));
};

export interface DecisionsChecked {
  readonly records: number;
  readonly issues: readonly DecisionIssue[];
}

export const checkDecisions = (runtime: Runtime, root: AbsolutePath, only?: string): DecisionsChecked => {
  const names = planFiles(runtime, root).filter(
    (name) => DECISION_FILE.test(name) && (only === undefined || name === only),
  );
  const issues = names.flatMap((name) => {
    const text = runtime.readText(planPath(root, name));
    return text.ok ? checkDecisionText(`${PLAN_DIR}/${name}`, text.value) : [];
  });
  return { records: names.length, issues };
};
