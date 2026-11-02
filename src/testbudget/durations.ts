import type { AbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { TEST_BUDGET_FEATURE } from "./budget.js";
import { parseReport, type Runner, runnerOf, RUNNERS, type TestTiming, withReporter } from "./reporters.js";

const DURATIONS_FILE = "test-durations.json";

export interface ReportPlan {
  readonly runner: Runner;
  readonly file: AbsolutePath;
  readonly exec: string;
}

export interface TestDurations {
  readonly treeHash: string;
  readonly runner: Runner;
  readonly tests: readonly TestTiming[];
}

export const reportPlan = (runtime: Runtime, paths: FmPaths, run: string): ReportPlan | undefined => {
  if (featureMode(runtime, paths, TEST_BUDGET_FEATURE) === "off") return undefined;
  if (configAt(loadProjectConfig(runtime, paths.root), "test_budget", "reporter") === "false") return undefined;
  const runner = runnerOf(run);
  if (runner === undefined) return undefined;
  const file = paths.cache(runner === "vitest" || runner === "jest" ? "test-report.json" : "test-report.xml");
  if (!runtime.writeText(file, "").ok) return undefined;
  return { runner, file, exec: withReporter(run, runner, file) };
};

export const recordDurations = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  plan: ReportPlan,
  treeHash: string,
): readonly TestTiming[] => {
  const text = runtime.readText(plan.file);
  const tests = text.ok ? parseReport(plan.runner, text.value, paths.root) : [];
  if (tests.length > 0)
    writeJsonFile(runtime, paths.cache(DURATIONS_FILE), {
      treeHash,
      runner: plan.runner,
      tests: tests.map((test) => ({ ...test })),
    });
  return tests;
};

const timingOf = (value: unknown): TestTiming[] =>
  isRecord(value) &&
  typeof value["file"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["ms"] === "number"
    ? [{ file: value["file"], name: value["name"], ms: value["ms"] }]
    : [];

export const readDurations = (runtime: Pick<Runtime, "readText">, paths: FmPaths): TestDurations | undefined => {
  const raw = readJsonFile(runtime, paths.cache(DURATIONS_FILE));
  const runner = RUNNERS.find((item) => item === raw?.["runner"]);
  const tests = raw?.["tests"];
  if (raw === undefined || runner === undefined || typeof raw["treeHash"] !== "string" || !Array.isArray(tests))
    return undefined;
  return { treeHash: raw["treeHash"], runner, tests: tests.flatMap(timingOf) };
};
