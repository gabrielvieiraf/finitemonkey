import type { AbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { IssueFact } from "./resolve.js";

const GH_TIMEOUT_MS = 30_000;
const ISSUE_LIMIT = "5000";

export interface Milestone {
  readonly title: string;
  readonly number: number;
  readonly closedIssues: number;
}

export type GhRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const ghJson = (runtime: Pick<Runtime, "exec">, root: AbsolutePath, args: readonly string[]): GhRead<unknown> => {
  const result = runtime.exec({ command: "gh", args, cwd: root, timeoutMs: GH_TIMEOUT_MS });
  if (!result.found) return { ok: false, detail: "gh is not installed" };
  if (result.exitCode !== 0)
    return { ok: false, detail: result.stderr.trim() || `gh exited ${String(result.exitCode)}` };
  const parsed = parseJson(result.stdout);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, detail: "gh printed something that is not JSON" };
};

const records = (value: unknown): readonly JsonObject[] =>
  Array.isArray(value) ? value.filter((item): item is JsonObject => isRecord(item)) : [];

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

export const issueFacts = (value: unknown): ReadonlyMap<number, IssueFact> =>
  new Map(
    records(value).flatMap((item): [number, IssueFact][] => {
      const number = numberOf(item["number"]);
      if (number === undefined) return [];
      const closed = typeof item["state"] === "string" && item["state"].toUpperCase() === "CLOSED";
      const reason = typeof item["stateReason"] === "string" ? item["stateReason"].toUpperCase() : "";
      const completed = closed && reason !== "NOT_PLANNED";
      return [[number, { state: closed ? "closed" : "open", completed }]];
    }),
  );

export const readIssues = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
): GhRead<ReadonlyMap<number, IssueFact>> => {
  const read = ghJson(runtime, root, [
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    ISSUE_LIMIT,
    "--json",
    "number,state,stateReason",
  ]);
  return read.ok ? { ok: true, value: issueFacts(read.value) } : read;
};

export const closingPrs = (runtime: Pick<Runtime, "exec">, root: AbsolutePath, issue: number): readonly number[] => {
  const read = ghJson(runtime, root, ["issue", "view", String(issue), "--json", "closedByPullRequestsReferences"]);
  if (!read.ok || !isRecord(read.value)) return [];
  return records(read.value["closedByPullRequestsReferences"]).flatMap((item) => numberOf(item["number"]) ?? []);
};

export const milestonesOf = (value: unknown): readonly Milestone[] =>
  records(value).flatMap((item): Milestone[] => {
    const number = numberOf(item["number"]);
    const open = numberOf(item["open_issues"]);
    const closedIssues = numberOf(item["closed_issues"]) ?? 0;
    const title = typeof item["title"] === "string" ? item["title"] : "";
    return number !== undefined && open === 0 ? [{ title, number, closedIssues }] : [];
  });

export const readEmptyMilestones = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
): GhRead<readonly Milestone[]> => {
  const read = ghJson(runtime, root, ["api", "repos/{owner}/{repo}/milestones?state=open&per_page=100"]);
  return read.ok ? { ok: true, value: milestonesOf(read.value) } : read;
};
