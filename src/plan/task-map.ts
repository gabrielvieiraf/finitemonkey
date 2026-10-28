import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { PLAN_DIR, planFiles, planPath } from "./folder.js";
import { table } from "./markdown.js";

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

export const TASK_MAP_SUFFIX = "-task-map.md";
export const ISSUES_CACHE = ".finitemonkey/cache/issues.json";

export interface IssueRef {
  readonly number: number;
  readonly title: string;
  readonly state: string;
}

export interface TaskMapRow {
  readonly issue: number;
  readonly title: string;
  readonly front: string;
  readonly state: string;
  readonly report: string;
  readonly line: number;
}

export interface IssueSnapshot {
  readonly at: string;
  readonly source: string;
  readonly issues: readonly IssueRef[];
}

export const findTaskMap = (names: readonly string[]): string | undefined =>
  names.find((name) => /^\d{2,}[a-z]?-/.test(name) && name.endsWith(TASK_MAP_SUFFIX));

const ROW = /^\|\s*#(\d+)\s*\|(.*)\|\s*$/;

export const parseTaskMap = (text: string): readonly TaskMapRow[] =>
  text.split(/\r?\n/).flatMap((line, index) => {
    const match = ROW.exec(line);
    if (match === null) return [];
    const cells = (match[2] ?? "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
    const [title = "", front = "", state = "", report = ""] = cells;
    return [{ issue: Number(match[1]), title, front, state, report, line: index + 1 }];
  });

export const renderTaskMap = (rows: readonly Omit<TaskMapRow, "line">[], at: string): string =>
  [
    "# Task map",
    "",
    `One row per issue, kept by \`finitemonkey fronts sync\` (last run ${at}). \`finitemonkey plan check\` fails on an issue without a row and on a row without an issue.`,
    "",
    ...table(
      ["Issue", "Title", "Front", "State", "Report"],
      rows.map((row) => [`#${String(row.issue)}`, row.title, row.front || "-", row.state, row.report || "-"]),
    ),
    "",
  ].join("\n");

const cachePath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, ISSUES_CACHE));

const issueOf = (value: unknown): IssueRef | undefined =>
  isRecord(value) && typeof value["number"] === "number"
    ? { number: value["number"], title: textOf(value["title"]), state: textOf(value["state"]) }
    : undefined;

export const readSnapshot = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): IssueSnapshot | undefined => {
  const text = runtime.readText(cachePath(root));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true || !Array.isArray(parsed.value["issues"])) return undefined;
  return {
    at: textOf(parsed.value["at"]),
    source: textOf(parsed.value["source"]),
    issues: parsed.value["issues"].flatMap((item: unknown) => issueOf(item) ?? []),
  };
};

export const writeSnapshot = (
  runtime: Pick<Runtime, "writeText">,
  root: AbsolutePath,
  snapshot: IssueSnapshot,
): void => {
  runtime.writeText(cachePath(root), `${JSON.stringify(snapshot, null, 2)}\n`);
};

export interface TaskMapIssue {
  readonly kind: "issue_without_row" | "row_without_issue";
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export const taskMapIssues = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  root: AbsolutePath,
): readonly TaskMapIssue[] => {
  const name = findTaskMap(planFiles(runtime, root));
  const snapshot = readSnapshot(runtime, root);
  if (name === undefined || snapshot === undefined) return [];
  const text = runtime.readText(planPath(root, name));
  if (!text.ok) return [];
  const rows = parseTaskMap(text.value);
  const listed = new Set(rows.map((row) => row.issue));
  const known = new Set(snapshot.issues.map((issue) => issue.number));
  const file = `${PLAN_DIR}/${name}`;
  return [
    ...snapshot.issues
      .filter((issue) => !listed.has(issue.number))
      .map((issue) => ({
        kind: "issue_without_row" as const,
        file,
        line: 1,
        detail: `#${String(issue.number)} ${issue.title}`,
      })),
    ...rows
      .filter((row) => !known.has(row.issue))
      .map((row) => ({ kind: "row_without_issue" as const, file, line: row.line, detail: `#${String(row.issue)}` })),
  ];
};
