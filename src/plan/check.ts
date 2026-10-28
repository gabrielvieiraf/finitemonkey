import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { linesOf } from "../inventory/grep.js";
import { responsibilitiesOf } from "../ownership/check.js";
import { ownershipPlanIssues } from "../ownership/plan.js";
import { PLAN_DIR, planFiles, planPath } from "./folder.js";
import { readFront } from "./front.js";
import { MASTER_FILE, planReports, previousVersions } from "./reports.js";
import {
  decisionIssues,
  indexIssues,
  numberIssues,
  orderIssues,
  ownerIssues,
  type PlanIssue,
  revokedIssues,
} from "./rules.js";
import { sectionsOf } from "./sections.js";
import { taskMapIssues } from "./task-map.js";

export interface PlanCheck {
  readonly master: string;
  readonly reports: number;
  readonly issues: readonly PlanIssue[];
}

const normalized = (text: string): string => text.replace(/\r\n/g, "\n").trimEnd();

const lineCount = (text: string): number => normalized(text).split("\n").length;

const growthIssues = (runtime: Runtime, root: AbsolutePath, master: string, current: string): readonly PlanIssue[] => {
  const git = gitAt(runtime, root);
  const commits = linesOf(git.out(["log", "--format=%H", "-n", "20", "--", master]));
  const previous = commits
    .map((commit) => git.out(["show", `${commit}:${master}`]))
    .find((text) => text !== undefined && normalized(text) !== normalized(current));
  if (previous === undefined || lineCount(current) <= lineCount(previous)) return [];
  const saved = previousVersions(planFiles(runtime, root)).some((name) => {
    const text = runtime.readText(planPath(root, name));
    return text.ok && normalized(text.value) === normalized(previous);
  });
  const detail = `${String(lineCount(previous))} -> ${String(lineCount(current))}`;
  return saved ? [] : [{ kind: "grew_without_previous", file: MASTER_FILE, line: 1, detail }];
};

export const checkPlan = (runtime: Runtime, root: AbsolutePath): PlanCheck => {
  const master = `${PLAN_DIR}/${MASTER_FILE}`;
  const text = runtime.readText(planPath(root, MASTER_FILE));
  const reports = planReports(runtime, root);
  if (!text.ok)
    return { master, reports: reports.length, issues: [{ kind: "no_master", file: master, line: 1, detail: master }] };
  const sections = sectionsOf(text.value);
  const names = reports.map((report) => report.name);
  const bodyLines = (report: (typeof reports)[number]) =>
    readFront(report.text)
      .body.split("\n")
      .map((line, index) => ({ text: line, line: index + 1 }));
  return {
    master,
    reports: reports.length,
    issues: [
      ...orderIssues(MASTER_FILE, sections),
      ...numberIssues(MASTER_FILE, sections, new Set(names)),
      ...indexIssues(MASTER_FILE, sections, names),
      ...decisionIssues(MASTER_FILE, sections, reports, bodyLines),
      ...ownerIssues(MASTER_FILE, sections),
      ...revokedIssues(reports),
      ...growthIssues(runtime, root, master, text.value),
      ...taskMapIssues(runtime, root),
      ...ownershipPlanIssues(runtime, root, master, responsibilitiesOf(text.value)),
    ],
  };
};
