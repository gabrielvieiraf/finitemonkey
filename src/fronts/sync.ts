import { type AbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { nextNumber, planFiles, planPath } from "../plan/folder.js";
import {
  findTaskMap,
  type IssueRef,
  type IssueSnapshot,
  parseTaskMap,
  readSnapshot,
  renderTaskMap,
  TASK_MAP_SUFFIX,
  type TaskMapRow,
  writeSnapshot,
} from "../plan/task-map.js";
import type { FrontsState } from "./state.js";

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

const GH_TIMEOUT_MS = 20_000;

const gh = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): unknown => {
  const result = runtime.exec({ command: "gh", args, cwd: root, timeoutMs: GH_TIMEOUT_MS });
  if (!result.found || result.exitCode !== 0) return undefined;
  const parsed = parseJson(result.stdout);
  return parsed.ok ? parsed.value : undefined;
};

const issueOf = (value: unknown): IssueRef | undefined =>
  isRecord(value) && typeof value["number"] === "number"
    ? {
        number: value["number"],
        title: textOf(value["title"]),
        state: textOf(value["state"]).toLowerCase(),
      }
    : undefined;

const projectIssues = (runtime: Runtime, root: AbsolutePath, project: string): readonly IssueRef[] | undefined => {
  const repo = gh(runtime, root, ["repo", "view", "--json", "owner"]);
  const owner = isRecord(repo) && isRecord(repo["owner"]) ? repo["owner"]["login"] : undefined;
  if (typeof owner !== "string") return undefined;
  const items = gh(runtime, root, [
    "project",
    "item-list",
    project,
    "--owner",
    owner,
    "--format",
    "json",
    "--limit",
    "1000",
  ]);
  const list = isRecord(items) ? items["items"] : undefined;
  if (!Array.isArray(list)) return undefined;
  return list.flatMap((item: unknown) => {
    const content = isRecord(item) ? item["content"] : undefined;
    if (!isRecord(content) || content["type"] !== "Issue") return [];
    return issueOf({ ...content, state: isRecord(item) ? item["status"] : undefined }) ?? [];
  });
};

export const fetchIssues = (
  runtime: Runtime,
  root: AbsolutePath,
  project: string | undefined,
): readonly IssueRef[] | undefined => {
  if (project !== undefined) return projectIssues(runtime, root, project);
  const list = gh(runtime, root, [
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "number,title,state",
  ]);
  return Array.isArray(list) ? list.flatMap((item: unknown) => issueOf(item) ?? []) : undefined;
};

export interface SyncResult {
  readonly file: string;
  readonly source: "github" | "local";
  readonly rows: readonly Omit<TaskMapRow, "line">[];
}

const rowsFrom = (
  issues: readonly IssueRef[],
  previous: readonly TaskMapRow[],
  state: FrontsState,
): readonly Omit<TaskMapRow, "line">[] =>
  issues
    .map((issue) => {
      const front = state.fronts.find((item) => item.issue === issue.number);
      const old = previous.find((row) => row.issue === issue.number);
      return {
        issue: issue.number,
        title: issue.title,
        front: front?.id ?? old?.front ?? "",
        state: front?.status ?? (issue.state === "" ? (old?.state ?? "") : issue.state),
        report: front?.lastReport ?? old?.report ?? "",
      };
    })
    .sort((left, right) => left.issue - right.issue);

export const syncTaskMap = (
  runtime: Runtime,
  root: AbsolutePath,
  state: FrontsState,
  project: string | undefined,
  offline: boolean,
): SyncResult => {
  const names = planFiles(runtime, root);
  const name = findTaskMap(names) ?? `${nextNumber(names)}${TASK_MAP_SUFFIX}`;
  const existing = runtime.readText(planPath(root, name));
  const previous = existing.ok ? parseTaskMap(existing.value) : [];
  const fetched = offline ? undefined : fetchIssues(runtime, root, project);
  const issues =
    fetched ??
    readSnapshot(runtime, root)?.issues ??
    previous.map((row) => ({ number: row.issue, title: row.title, state: row.state }));
  const now = runtime.now();
  if (fetched !== undefined) {
    const snapshot: IssueSnapshot = {
      at: now,
      source: project === undefined ? "gh issue list" : `gh project ${project}`,
      issues: fetched,
    };
    writeSnapshot(runtime, root, snapshot);
  }
  const rows = rowsFrom(issues, previous, state);
  runtime.mkdir(planPath(root, ""));
  runtime.writeText(planPath(root, name), renderTaskMap(rows, now));
  return { file: `docs/plan/${name}`, source: fetched === undefined ? "local" : "github", rows };
};
