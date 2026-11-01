import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Evidence } from "../evidence/types.js";
import { RECORD_DIR } from "../knowledge/decision-record.js";
import { parseLog } from "../stale/release.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile } from "../task/state.js";

export interface FinishedTask {
  readonly task: string;
  readonly at: string;
}

export interface RecordedDecision {
  readonly task: string;
  readonly at: string;
  readonly changes: readonly string[];
}

export interface PeriodCommit {
  readonly sha: string;
  readonly type: string;
  readonly scope: string | null;
  readonly subject: string;
  readonly body: string;
}

const HEADER = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/;

export const inWindow = (at: string, since: string): boolean => Date.parse(at) >= Date.parse(since);

export const finishedTasks = (evidence: readonly Evidence[], since: string): readonly FinishedTask[] => {
  const latest = new Map<string, string>();
  for (const entry of evidence) {
    if (entry.kind !== "state" || entry.state !== "verified" || !inWindow(entry.at, since)) continue;
    const prior = latest.get(entry.task);
    if (prior === undefined || Date.parse(entry.at) > Date.parse(prior)) latest.set(entry.task, entry.at);
  }
  return [...latest.entries()].map(([task, at]) => ({ task, at })).sort((a, b) => a.at.localeCompare(b.at));
};

export const periodCommits = (
  runtime: Pick<Runtime, "git">,
  root: AbsolutePath,
  since: string,
): readonly PeriodCommit[] => {
  const result = runtime.git(["log", `--since=${since}`, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e"], root);
  if (!result.ok) return [];
  return parseLog(result.stdout).map((commit) => {
    const header = HEADER.exec(commit.subject);
    return {
      sha: commit.sha.slice(0, 12),
      type: header?.[1] ?? "other",
      scope: header?.[2] ?? null,
      subject: header?.[3] ?? commit.subject,
      body: commit.body,
    };
  });
};

export const recordedDecisions = (
  runtime: Pick<Runtime, "listDir" | "readText">,
  paths: FmPaths,
  since: string,
): readonly RecordedDecision[] => {
  const dir = toAbsolutePath(join(paths.dir, RECORD_DIR));
  const listed = runtime.listDir(dir);
  const names = listed.ok ? listed.value.filter((name) => name.endsWith(".json")).sort() : [];
  return names.flatMap((name): RecordedDecision[] => {
    const raw = readJsonFile(runtime, toAbsolutePath(join(dir, name)));
    const at = raw?.["at"];
    const task = raw?.["task"];
    if (typeof at !== "string" || typeof task !== "string" || !inWindow(at, since)) return [];
    const changes = Array.isArray(raw?.["changes"]) ? raw["changes"] : [];
    return [
      {
        task,
        at,
        changes: changes.flatMap((item: unknown) =>
          isRecord(item) && typeof item["detail"] === "string" ? [item["detail"]] : [],
        ),
      },
    ];
  });
};
