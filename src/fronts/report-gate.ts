import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { gitAt, treeHash } from "../gate/git.js";
import { dirtyFiles } from "../wt/classify.js";
import { type FrontReport, parseFrontReport } from "./report.js";
import type { Front } from "./state.js";

export const REPORTS_DIR = ".finitemonkey/reports";

export interface ReportCheck {
  readonly front: string;
  readonly file: string | undefined;
  readonly report: FrontReport | undefined;
  readonly problems: readonly string[];
}

const reportFiles = (root: AbsolutePath, front: Front): readonly AbsolutePath[] => [
  ...(front.path === null ? [] : [toAbsolutePath(join(front.path, REPORTS_DIR, `${front.id}.json`))]),
  toAbsolutePath(join(root, REPORTS_DIR, `${front.id}.json`)),
];

export const locateReport = (runtime: Runtime, root: AbsolutePath, front: Front): AbsolutePath | undefined =>
  reportFiles(root, front)
    .filter((file) => runtime.stat(file) !== undefined)
    .sort((left, right) => (runtime.stat(right)?.mtimeMs ?? 0) - (runtime.stat(left)?.mtimeMs ?? 0))[0];

const headOf = (runtime: Runtime, dir: string): string | undefined => {
  const result = runtime.git(["rev-parse", "HEAD"], toAbsolutePath(dir));
  return result.ok ? result.stdout.trim() : undefined;
};

const ledgerProblems = (runtime: Runtime, dir: AbsolutePath, report: FrontReport): readonly string[] => {
  const claimed = report.tests.passed + report.tests.failed;
  if (claimed === 0) return [];
  const tree = treeHash(gitAt(runtime, dir));
  const ledger = readLedger(
    runtime,
    toAbsolutePath(
      report.evidence === "" ? join(dir, ".finitemonkey", "evidence", `${report.front}.jsonl`) : report.evidence,
      dir,
    ),
  );
  const entry = ledger.findLast((item) => item.kind === "tests" && item.treeHash === tree);
  if (entry === undefined)
    return [
      `tests: no ledger entry for the worktree at ${report.head.slice(0, 12)} (${report.evidence || "no evidence path"})`,
    ];
  const problems: string[] = [];
  if (entry.testCount !== undefined && entry.testCount !== claimed) {
    problems.push(`tests: the report claims ${String(claimed)} tests, the ledger ran ${String(entry.testCount)}`);
  }
  if ((report.tests.failed === 0) !== (entry.status === "passed")) {
    problems.push(`tests: the report says ${String(report.tests.failed)} failed, the ledger says ${entry.status}`);
  }
  return problems;
};

const worktreeProblems = (runtime: Runtime, front: Front, report: FrontReport): readonly string[] => {
  if (front.path === null || runtime.stat(toAbsolutePath(front.path)) === undefined) return [];
  const dir = toAbsolutePath(front.path);
  const head = headOf(runtime, dir);
  const problems: string[] = [];
  if (head === undefined || report.head.length < 7 || !head.startsWith(report.head)) {
    problems.push(`head: the report says ${report.head}, the worktree is at ${head ?? "nothing"}`);
  }
  const dirty = dirtyFiles(runtime, dir, []).filter((path) => !path.startsWith(REPORTS_DIR));
  if (dirty.length > 0 && report.left_out.length === 0) {
    problems.push(`worktree: uncommitted ${dirty.slice(0, 5).join(", ")} and nothing in left_out`);
  }
  const missing = report.screenshots.filter(
    (shot) => shot.opened && runtime.stat(toAbsolutePath(shot.path, dir)) === undefined,
  );
  problems.push(...missing.map((shot) => `screenshots: ${shot.path} does not exist`));
  return [...problems, ...ledgerProblems(runtime, dir, report)];
};

export const checkReport = (runtime: Runtime, root: AbsolutePath, front: Front): ReportCheck => {
  const file = locateReport(runtime, root, front);
  if (file === undefined)
    return {
      front: front.id,
      file,
      report: undefined,
      problems: [`report: ${REPORTS_DIR}/${front.id}.json is missing`],
    };
  const text = runtime.readText(file);
  if (!text.ok) return { front: front.id, file, report: undefined, problems: [`report: ${text.error}`] };
  const parsed = parseFrontReport(text.value);
  if (parsed.report === undefined)
    return { front: front.id, file, report: undefined, problems: parsed.issues.map((issue) => `report: ${issue}`) };
  const naming = parsed.report.front === front.id ? [] : [`front: the report is for ${parsed.report.front}`];
  const answered = new Set((parsed.report.inbox ?? []).map((item) => item.text.trim()));
  const unanswered = front.inbox
    .filter((item) => !answered.has(item.text.trim()))
    .map((item) => `inbox: the message from ${item.at} ("${item.text.slice(0, 60)}") is not in the report`);
  return {
    front: front.id,
    file,
    report: parsed.report,
    problems: [...naming, ...unanswered, ...worktreeProblems(runtime, front, parsed.report)],
  };
};

export const reportSummary = (check: ReportCheck): string => {
  const report = check.report;
  if (report === undefined) return `${check.front}: no valid report`;
  const tests = `${String(report.tests.passed)} passed, ${String(report.tests.failed)} failed, ${String(report.tests.added)} added`;
  const left = report.left_out.length === 0 ? "" : `; left out: ${report.left_out.map((item) => item.what).join(", ")}`;
  const decisions =
    report.provisional_decisions.length === 0
      ? ""
      : `; decisions: ${report.provisional_decisions.map((item) => item.decision).join(", ")}`;
  return `${check.front} at ${report.head.slice(0, 12)}: ${report.delivered.join(", ") || "nothing delivered"}; tests ${tests}${left}${decisions}`;
};
