import { join, posix } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type Change, fileAt, type Git } from "../gate/git.js";
import { isQualityFile, type QualityLimits } from "../quality/limits.js";
import { type FileMetrics, fileMetrics } from "../quality/metrics.js";
import { isTsFamily, type TsApi } from "../quality/ts-api.js";
import { exampleFor, type NearbyFile } from "./example.js";
import { type Candidate, rankCandidates, type TouchedMetrics } from "./rank.js";
import { dismissedSpots, latest, mutedFor, nextId, readHistory, ruleRates } from "./store.js";
import { MAX_SUGGESTIONS, type Suggestion } from "./types.js";

export interface AdviceInput {
  readonly runtime: Runtime;
  readonly root: AbsolutePath;
  readonly git: Git;
  readonly base: string;
  readonly changes: readonly Change[];
  readonly task: string;
  readonly person: string;
  readonly limits: QualityLimits;
  readonly ts: TsApi | undefined;
}

const MAX_FILES = 20;
const MAX_NEARBY = 15;
const CHURN_WINDOW = "90.days";

const read = (input: AdviceInput, file: string): string | undefined => {
  const text = input.runtime.readText(toAbsolutePath(join(input.root, file)));
  return text.ok ? text.value : undefined;
};

const metricsOf = (input: AdviceInput, file: string, text: string): FileMetrics =>
  fileMetrics(isTsFamily(file) ? input.ts : undefined, file, text);

export const churnOf = (git: Git, files: readonly string[]): ReadonlyMap<string, number> => {
  const out = git.out(["log", `--since=${CHURN_WINDOW}`, "--format=", "--numstat", "--no-renames", "--", ...files]);
  const churn = new Map<string, number>();
  for (const row of (out ?? "").split("\n")) {
    const [plus = "", minus = "", file = ""] = row.split("\t");
    if (file === "") continue;
    churn.set(file, (churn.get(file) ?? 0) + (Number(plus) || 0) + (Number(minus) || 0));
  }
  return churn;
};

const touchedMetrics = (input: AdviceInput): readonly TouchedMetrics[] => {
  const files = input.changes
    .filter((change) => change.status !== "D" && isQualityFile(change.path, input.limits))
    .slice(0, MAX_FILES);
  const churn = churnOf(
    input.git,
    files.map((change) => change.path),
  );
  return files.flatMap((change): TouchedMetrics[] => {
    const after = read(input, change.path);
    if (after === undefined) return [];
    const old = change.status === "A" ? undefined : fileAt(input.git, input.base, change.oldPath ?? change.path);
    return [
      {
        file: change.path,
        churn: churn.get(change.path) ?? 0,
        before: old === undefined ? undefined : metricsOf(input, change.path, old),
        after: metricsOf(input, change.path, after),
      },
    ];
  });
};

const nearbyFiles = (input: AdviceInput, touched: readonly TouchedMetrics[]): readonly NearbyFile[] => {
  const dirs = [...new Set(touched.map((item) => posix.dirname(item.file)))];
  const siblings = dirs.flatMap((dir) => {
    const listed = input.runtime.listDir(toAbsolutePath(join(input.root, dir)));
    return listed.ok ? listed.value.map((name) => (dir === "." ? name : `${dir}/${name}`)) : [];
  });
  const extra = siblings
    .filter((file) => isTsFamily(file) && isQualityFile(file, input.limits))
    .filter((file) => !touched.some((item) => item.file === file))
    .slice(0, MAX_NEARBY)
    .flatMap((file) => {
      const text = read(input, file);
      return text === undefined ? [] : [{ file, metrics: metricsOf(input, file, text) }];
    });
  return [...touched.map((item) => ({ file: item.file, metrics: item.after })), ...extra];
};

const skipFilter = (input: AdviceInput) => {
  const current = latest(readHistory(input.runtime, input.root));
  const dismissed = dismissedSpots(current);
  const muted = mutedFor(current, input.person);
  const retired = new Set(
    ruleRates(current)
      .filter((rate) => rate.retired)
      .map((rate) => rate.rule),
  );
  const open = new Set(
    current
      .filter((item) => item.state === "open" || item.state === "accepted")
      .map((item) => `${item.rule}\u0000${item.file}\u0000${item.name}`),
  );
  return {
    current,
    skip: (candidate: Candidate): boolean =>
      dismissed.has(`${candidate.rule}\u0000${candidate.file}`) ||
      muted.has(candidate.rule) ||
      retired.has(candidate.rule) ||
      open.has(`${candidate.rule}\u0000${candidate.file}\u0000${candidate.name}`),
  };
};

export const advise = (input: AdviceInput): readonly Suggestion[] => {
  const touched = touchedMetrics(input);
  if (touched.length === 0) return [];
  const filter = skipFilter(input);
  const ranked = rankCandidates(touched, input.limits, { skip: filter.skip, max: MAX_SUGGESTIONS });
  if (ranked.length === 0) return [];
  const nearby = nearbyFiles(input, touched);
  const first = Number(nextId(filter.current).slice(1));
  return ranked.map((candidate, index): Suggestion => {
    const example = exampleFor(candidate, nearby);
    return {
      id: `S${String(first + index)}`,
      at: input.runtime.now(),
      task: input.task,
      ...candidate,
      ...(example === undefined ? {} : { example }),
      state: "open",
    };
  });
};
