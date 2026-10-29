import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type AddedLine, addedLines, type Git } from "../gate/git.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { prepareGate } from "../gate/prepare.js";
import { readEntries, signalFiles } from "../signals/store.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { changeEvents, type ConceptEvent, recordConceptEvents } from "./evidence.js";

export const CREDIT_FILE = "conceitos-credit.json";

interface Credited {
  readonly task: string;
  readonly status: string;
  readonly tree: string;
}

const creditPath = (paths: FmPaths): ReturnType<FmPaths["cache"]> => paths.cache(CREDIT_FILE);

const readCredited = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Credited | undefined => {
  const raw = readJsonFile(runtime, creditPath(paths));
  const task = raw?.["task"];
  const status = raw?.["status"];
  const tree = raw?.["tree"];
  return typeof task === "string" && typeof status === "string" && typeof tree === "string"
    ? { task, status, tree }
    : undefined;
};

export const creditPending = (runtime: Pick<Runtime, "readText">, paths: FmPaths): boolean => {
  const status = readGateStatus(runtime, paths);
  if (status?.tree === undefined) return false;
  const credited = readCredited(runtime, paths);
  return credited?.tree !== status.tree || credited.status !== status.status || credited.task !== status.task;
};

export const agentFiles = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlySet<string> =>
  new Set(
    readEntries(runtime, signalFiles(paths)).flatMap((entry) =>
      entry.kind === "edit" && entry.file !== "" ? [entry.file] : [],
    ),
  );

const MAX_UNTRACKED_BYTES = 200_000;

export const untrackedLines = (runtime: Pick<Runtime, "readText">, git: Git, paths: FmPaths): readonly AddedLine[] =>
  (git.out(["ls-files", "--others", "--exclude-standard", "-z"]) ?? "")
    .split("\0")
    .filter((file) => file !== "" && !file.startsWith(".finitemonkey/"))
    .flatMap((file) => {
      const text = runtime.readText(toAbsolutePath(join(paths.root, file)));
      if (!text.ok || text.value.length > MAX_UNTRACKED_BYTES) return [];
      return text.value.split("\n").map((line, index) => ({ path: file, line: index + 1, text: line }));
    });

export const creditGate = (runtime: Runtime, paths: FmPaths): readonly ConceptEvent[] => {
  const status = readGateStatus(runtime, paths);
  if (status?.tree === undefined) return [];
  const before = readCredited(runtime, paths);
  const now: Credited = { task: status.task, status: status.status, tree: status.tree };
  if (before?.tree === now.tree && before.status === now.status && before.task === now.task) return [];
  writeJsonFile(runtime, creditPath(paths), { ...now });
  if (status.status !== "passed") return [];
  const ready = prepareGate({
    runtime,
    cwd: paths.root,
    env: {},
    sessionId: undefined,
    budgetMs: 0,
    fast: true,
    noSkip: true,
  });
  if (ready.kind !== "ready" || ready.prepared.ctx.treeHash !== status.tree) return [];
  const { ctx } = ready.prepared;
  const repaired = before?.task === status.task && before.status === "failed";
  const drafts = changeEvents([...addedLines(ctx.git, ctx.base), ...untrackedLines(runtime, ctx.git, paths)], {
    agentFiles: agentFiles(runtime, paths),
    repaired,
    task: status.task,
  });
  return recordConceptEvents(runtime, paths, drafts);
};
