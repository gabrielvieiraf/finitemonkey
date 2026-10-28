import { citationsIn, type PlanReport } from "./reports.js";
import { MASTER_SECTIONS, masterSectionOf, type Section } from "./sections.js";

export const PLAN_ISSUES = [
  "no_master",
  "order",
  "number_without_report",
  "missing_report",
  "not_indexed",
  "decided_twice",
  "two_owners",
  "no_owner",
  "revoked_without_banner",
  "grew_without_previous",
  "issue_without_row",
  "row_without_issue",
  "ownership_gap",
  "ownership_overlap",
] as const;

export type PlanIssueKind = (typeof PLAN_ISSUES)[number];

export interface PlanIssue {
  readonly kind: PlanIssueKind;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

type Line = Section["lines"][number];

const issue = (kind: PlanIssueKind, file: string, line: number, detail: string): PlanIssue => ({
  kind,
  file,
  line,
  detail,
});

const linesIn = (sections: readonly Section[], id: (typeof MASTER_SECTIONS)[number]): readonly Line[] =>
  sections.filter((section) => masterSectionOf(section.heading) === id).flatMap((section) => section.lines);

export const orderIssues = (master: string, sections: readonly Section[]): readonly PlanIssue[] => {
  const ids = sections.flatMap((section) => masterSectionOf(section.heading) ?? []);
  const inOrder = ids.length === MASTER_SECTIONS.length && ids.every((id, index) => id === MASTER_SECTIONS[index]);
  return inOrder ? [] : [issue("order", master, sections[0]?.line ?? 1, ids.join(", "))];
};

const NOISE = [
  /\[[^\]]*\]\([^)]*\)/g,
  /\b\d{2,}[a-z]?-[\w.-]+?\.md\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /^\s*(?:[-*+]|\d+[.)])\s+/,
];

const hasNumber = (text: string): boolean =>
  /\d/.test(NOISE.reduce((rest, pattern) => rest.replace(pattern, " "), text));

export const numberIssues = (
  master: string,
  sections: readonly Section[],
  reports: ReadonlySet<string>,
): readonly PlanIssue[] =>
  sections
    .filter((section) => masterSectionOf(section.heading) !== "reports")
    .flatMap((section) => section.lines)
    .filter((line) => !/^\s*\|?\s*-{3}/.test(line.text) && hasNumber(line.text))
    .flatMap((line) => {
      const cited = citationsIn(line.text);
      if (cited.length === 0) return [issue("number_without_report", master, line.line, line.text.trim())];
      return cited.filter((name) => !reports.has(name)).map((name) => issue("missing_report", master, line.line, name));
    });

export const indexIssues = (
  master: string,
  sections: readonly Section[],
  reports: readonly string[],
): readonly PlanIssue[] => {
  const listed = new Set(linesIn(sections, "reports").flatMap((line) => citationsIn(line.text)));
  return reports.filter((name) => !listed.has(name)).map((name) => issue("not_indexed", master, 1, name));
};

const clean = (text: string): string =>
  text
    .replace(/[*`_]/g, "")
    .replace(/\([^)]*\.md\)|\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const DECIDES = /^\s*(?:[-*]\s*)?\**(?:decides|decide|decisão|decisión)\**\s*:\s*(.+?)\s*(?:=|->|→)\s*(.+?)\s*$/i;
const BULLET = /^\s*[-*]\s+(.+?):\s+(.+)$/;

interface Choice {
  readonly topic: string;
  readonly choice: string;
  readonly file: string;
  readonly line: number;
}

const conflicts = (choices: readonly Choice[]): readonly PlanIssue[] => {
  const first = new Map<string, Choice>();
  return choices.flatMap((item) => {
    const seen = first.get(item.topic);
    if (seen === undefined) first.set(item.topic, item);
    if (seen === undefined || seen.choice === item.choice) return [];
    return [issue("decided_twice", item.file, item.line, `${item.topic}: ${seen.file}:${String(seen.line)}`)];
  });
};

const choiceOf = (pattern: RegExp, file: string, line: Line): Choice | undefined => {
  const match = pattern.exec(line.text);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { topic: clean(match[1]), choice: clean(match[2]), file, line: line.line };
};

export const decisionIssues = (
  master: string,
  sections: readonly Section[],
  reports: readonly PlanReport[],
  reportLines: (report: PlanReport) => readonly Line[],
): readonly PlanIssue[] => [
  ...conflicts(linesIn(sections, "decisions").flatMap((line) => choiceOf(BULLET, master, line) ?? [])),
  ...conflicts(
    reports
      .filter((report) => !report.revoked)
      .flatMap((report) => reportLines(report).flatMap((line) => choiceOf(DECIDES, report.name, line) ?? [])),
  ),
];

const NOBODY = new Set(["", "-", "?", "none", "nobody", "tbd", "ninguém", "nenhum", "nadie", "ninguno"]);
const SEVERAL = /,|;|\/|&|\+|\s(and|e|y)\s/i;

const cellsOf = (text: string): readonly string[] =>
  text
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

export const ownerIssues = (master: string, sections: readonly Section[]): readonly PlanIssue[] => {
  const rows = linesIn(sections, "responsibilities").filter((line) => line.text.trim().startsWith("|"));
  const owners = new Map<string, string>();
  return rows.slice(1).flatMap((row) => {
    const [name = "", owner = ""] = cellsOf(row.text);
    if (/^-{3}/.test(name) || clean(name) === "") return [];
    if (NOBODY.has(clean(owner))) return [issue("no_owner", master, row.line, name)];
    if (SEVERAL.test(owner)) return [issue("two_owners", master, row.line, `${name}: ${owner}`)];
    const before = owners.get(clean(name));
    owners.set(clean(name), clean(owner));
    return before !== undefined && before !== clean(owner)
      ? [issue("two_owners", master, row.line, `${name}: ${owner}`)]
      : [];
  });
};

export const revokedIssues = (reports: readonly PlanReport[]): readonly PlanIssue[] =>
  reports
    .filter((report) => report.revoked && !report.banner)
    .map((report) => issue("revoked_without_banner", report.name, 1, report.name));
