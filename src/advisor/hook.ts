import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { logEvent } from "../evidence/log.js";
import { changedFiles, gitAt, resolveBase } from "../gate/git.js";
import { allowWith, human, projectPaths } from "../gate/hooks/common.js";
import { readGateStatus } from "../gate/hooks/status.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { modeOf, readShadow } from "../policy/guards.js";
import { loadPolicy } from "../policy/policy.js";
import { loadLimits } from "../quality/limits.js";
import { loadTypescript } from "../quality/ts-api.js";
import { loadTask } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { advise } from "./advise.js";
import { closeAccepted } from "./close.js";
import { appendSuggestions } from "./store.js";
import { ADVISOR_GUARD, type Suggestion } from "./types.js";

const ALLOW: HookDecision = { kind: "allow" };
const CACHE_FILE = "advisor.json";

const METRIC_LABELS = {
  cognitive: "advisor.metric.cognitive",
  nesting: "advisor.metric.nesting",
  lines: "advisor.metric.lines",
  params: "advisor.metric.params",
  chain: "advisor.metric.chain",
  identifiers: "advisor.metric.identifiers",
} as const;

const metricLabel = (t: Translate, metric: string): string => {
  const key = Object.entries(METRIC_LABELS).find(([name]) => name === metric)?.[1];
  return key === undefined ? metric : t(key);
};

export const suggestionLine = (t: Translate, item: Suggestion): string =>
  t(item.example === undefined ? "advisor.line" : "advisor.line_example", {
    id: item.id,
    refactoring: item.refactoring,
    name: item.name,
    file: item.file,
    line: item.line,
    metric: metricLabel(t, item.metric),
    value: item.value,
    target: item.target,
    example: item.example ?? "",
  });

const contractBase = (input: HookInput, paths: FmPaths, task: string): string | undefined => {
  const disk = (file: string): string | undefined => {
    const text = input.runtime.readText(toAbsolutePath(join(paths.root, file)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(input.runtime, paths, { disk, base: () => undefined }, task);
  return loaded.ok ? loaded.value.contract.base : undefined;
};

const personOf = (input: HookInput, paths: FmPaths): string =>
  input.runtime.git(["config", "user.name"], paths.root).stdout.trim() || "person";

const suggest = (input: HookInput, paths: FmPaths, task: string): readonly Suggestion[] => {
  const git = gitAt(input.runtime, paths.root);
  const base = resolveBase(git, contractBase(input, paths, task));
  return advise({
    runtime: input.runtime,
    root: paths.root,
    git,
    base,
    changes: changedFiles(git, base),
    task,
    person: personOf(input, paths),
    limits: loadLimits(input.runtime, paths.root),
    ts: loadTypescript(paths.root),
  });
};

const freshGate = (input: HookInput, paths: FmPaths): string | undefined => {
  const status = readGateStatus(input.runtime, paths);
  if (status?.status !== "passed") return undefined;
  if (readJsonFile(input.runtime, paths.cache(CACHE_FILE))?.["at"] === status.at) return undefined;
  writeJsonFile(input.runtime, paths.cache(CACHE_FILE), { at: status.at, task: status.task });
  return status.task;
};

const run = (input: HookInput, paths: FmPaths): HookDecision => {
  const task = freshGate(input, paths);
  if (task === undefined) return ALLOW;
  const mode = modeOf(
    { id: ADVISOR_GUARD, damage: false },
    loadPolicy(input.runtime, paths.root),
    readShadow(input.runtime, paths),
  );
  closeAccepted(input.runtime, paths, task);
  const found = suggest(input, paths, task);
  if (found.length === 0) return ALLOW;
  const detail = { task, mode, ids: found.map((item) => item.id), rules: found.map((item) => item.rule) };
  logEvent(input.runtime, paths, "advisor.suggested", detail);
  if (mode === "shadow") return ALLOW;
  appendSuggestions(input.runtime, paths.root, found);
  const { t } = input;
  const lines = [
    t("advisor.header", { count: found.length }),
    ...found.map((item) => suggestionLine(t, item)),
    t("advisor.footer"),
  ];
  return allowWith({ systemMessage: human(lines.join("\n")) });
};

export const advisorStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return ALLOW;
  try {
    return run(input, paths);
  } catch (error) {
    logEvent(input.runtime, paths, "advisor.failed", {
      detail: error instanceof Error ? error.message : String(error),
    });
    return ALLOW;
  }
};

export const ADVISOR_HANDLERS: HookHandlers = { Stop: [advisorStop] };
