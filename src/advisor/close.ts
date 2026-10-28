import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { fileMetrics, type FunctionMetric } from "../quality/metrics.js";
import { isTsFamily, loadTypescript } from "../quality/ts-api.js";
import type { FmPaths } from "../task/paths.js";
import { appendSuggestions, latest, readHistory } from "./store.js";
import type { Suggestion } from "./types.js";

const pick = (fn: FunctionMetric, metric: string): number | undefined => {
  const values: Readonly<Record<string, number>> = {
    cognitive: fn.cognitive,
    nesting: fn.nesting,
    lines: fn.lines,
    params: fn.params,
    chain: fn.chain,
    identifiers: fn.identifiers,
  };
  return values[metric];
};

export const currentValue = (runtime: Runtime, paths: FmPaths, item: Suggestion): number | undefined => {
  const text = runtime.readText(toAbsolutePath(join(paths.root, item.file)));
  if (!text.ok) return undefined;
  const ts = isTsFamily(item.file) ? loadTypescript(paths.root) : undefined;
  const metrics = fileMetrics(ts, item.file, text.value);
  if (item.rule === "large_module") return metrics.lines;
  const fn = metrics.functions.find((entry) => entry.name === item.name);
  return fn === undefined ? 0 : pick(fn, item.metric);
};

export const greenBefore = (item: Suggestion): boolean =>
  item.before !== undefined && item.before.length > 0 && item.before.every((run) => run.exitCode === 0);

export const closeAccepted = (runtime: Runtime, paths: FmPaths, task: string): readonly Suggestion[] => {
  const ready = latest(readHistory(runtime, paths.root)).filter(
    (item) => item.state === "accepted" && item.refactorTask === task,
  );
  const closed = ready.flatMap((item): Suggestion[] => {
    if (!greenBefore(item)) {
      logEvent(runtime, paths, "advisor.not_closed", { id: item.id, reason: "red_before" });
      return [];
    }
    const after = currentValue(runtime, paths, item);
    logEvent(runtime, paths, "advisor.closed", {
      id: item.id,
      rule: item.rule,
      before: item.value,
      after: after ?? null,
    });
    return [{ ...item, at: runtime.now(), state: "closed", ...(after === undefined ? {} : { after }) }];
  });
  appendSuggestions(runtime, paths.root, closed);
  return closed;
};
