import type { Runtime } from "../core/runtime.js";
import { DECISION_FILE } from "../decide/check.js";
import { readLedger } from "../evidence/ledger.js";
import { GATE_CHECK } from "../evidence/types.js";
import { gitAt } from "../gate/git.js";
import { PLAN_DIR, planFiles } from "../plan/folder.js";
import type { FmPaths } from "../task/paths.js";
import type { DecisionEntry } from "./decisions.js";
import { knownTasks } from "./tasks.js";

export const REVERT_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface Outcome {
  readonly reverted: readonly string[];
  readonly gateFailures: number;
  readonly reopenedBy?: string;
}

export const overlaps = (left: string, right: string): boolean => {
  const a = left.replace(/\/+$/, "");
  const b = right.replace(/\/+$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};

const touches = (files: readonly string[], area: readonly string[]): boolean =>
  files.some((file) => area.some((path) => overlaps(file, path)));

interface Commit {
  readonly hash: string;
  readonly at: number;
  readonly subject: string;
  readonly files: readonly string[];
}

const SEPARATOR = "\u001e";

export const commitsSince = (
  runtime: Pick<Runtime, "exec">,
  root: FmPaths["root"],
  since: string,
): readonly Commit[] => {
  const result = gitAt(runtime, root).run([
    "log",
    `--since=${since}`,
    `--format=${SEPARATOR}%H%x09%cI%x09%s`,
    "--name-only",
  ]);
  if (!result.found || result.exitCode !== 0) return [];
  return result.stdout
    .split(SEPARATOR)
    .slice(1)
    .flatMap((block) => {
      const [head = "", ...files] = block.split("\n").map((line) => line.trim());
      const [hash = "", at = "", ...subject] = head.split("\t");
      const time = Date.parse(at);
      return hash === "" || !Number.isFinite(time)
        ? []
        : [{ hash, at: time, subject: subject.join("\t"), files: files.filter((file) => file !== "") }];
    });
};

const reverts = (commits: readonly Commit[], entry: DecisionEntry): readonly string[] => {
  const start = Date.parse(entry.at);
  return commits
    .filter((commit) => commit.at >= start && commit.at <= start + REVERT_WINDOW_DAYS * DAY_MS)
    .filter((commit) => /^revert\b/i.test(commit.subject) && touches(commit.files, entry.paths))
    .map((commit) => commit.hash.slice(0, 12));
};

const gateFailures = (runtime: Pick<Runtime, "readText" | "listDir">, paths: FmPaths, entry: DecisionEntry): number =>
  knownTasks(runtime, paths)
    .filter((task) => touches(task.contract.scope.paths, entry.paths))
    .flatMap((task) => readLedger(runtime, paths.evidence(task.contract.id)))
    .filter((item) => item.check === GATE_CHECK && item.status === "failed" && item.at >= entry.at).length;

const topicOf = (file: string): string =>
  file
    .replace(/^.*\//, "")
    .replace(/^\d+[a-z]?-decision-/, "")
    .replace(/\.md$/, "");

const reopenedBy = (runtime: Pick<Runtime, "listDir">, paths: FmPaths, entry: DecisionEntry): string | undefined => {
  if (entry.source !== "decide") return undefined;
  const own = entry.subject.replace(/^.*\//, "");
  const later = planFiles(runtime, paths.root).filter(
    (name) => DECISION_FILE.test(name) && name > own && topicOf(name) === topicOf(own),
  );
  return later[0] === undefined ? undefined : `${PLAN_DIR}/${later[0]}`;
};

export const outcomeOf = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  paths: FmPaths,
  commits: readonly Commit[],
  entry: DecisionEntry,
): Outcome => {
  const reopened = reopenedBy(runtime, paths, entry);
  return {
    reverted: entry.paths.length === 0 ? [] : reverts(commits, entry),
    gateFailures: entry.paths.length === 0 ? 0 : gateFailures(runtime, paths, entry),
    ...(reopened === undefined ? {} : { reopenedBy: reopened }),
  };
};
