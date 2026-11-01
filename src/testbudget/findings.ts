import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { type Finding, stableFindingId } from "../findings/baseline.js";
import { configAt, configList, type ConfigTree, loadProjectConfig } from "../git/project-config.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { fmPaths } from "../task/paths.js";
import { parseCoverage, type Redundant, redundantTests } from "./budget.js";
import { readDurations } from "./durations.js";
import type { TestTiming } from "./reporters.js";

export const TEST_BUDGET_CHECK = "test-budget";
export const SLOW_TEST_RULE = "slow-test";
export const REDUNDANT_TEST_RULE = "redundant-test";
export const DEFAULT_SLOW_TEST_MS = 1000;

export interface BudgetFinding extends Finding {
  readonly test: string;
  readonly ms?: number;
  readonly other?: string;
}

const findingFor = (rule: string, file: string, test: string): Finding => {
  const fingerprint = sha256Hex(test).slice(0, 16);
  return {
    id: stableFindingId(TEST_BUDGET_CHECK, rule, file, fingerprint),
    check: TEST_BUDGET_CHECK,
    rule,
    file,
    line: 0,
    fingerprint,
  };
};

export const slowTestFindings = (tests: readonly TestTiming[], limitMs: number): readonly BudgetFinding[] =>
  tests
    .filter((test) => test.ms >= limitMs)
    .map((test) => ({ ...findingFor(SLOW_TEST_RULE, test.file, test.name), test: test.name, ms: test.ms }));

export const redundantFindings = (redundant: readonly Redundant[]): readonly BudgetFinding[] =>
  redundant.map((item) => ({
    ...findingFor(REDUNDANT_TEST_RULE, item.test, item.test),
    test: item.test,
    other: item.coveredBy,
  }));

export const slowTestLimit = (config: ConfigTree): number => {
  const raw = configAt(config, "test_budget", "slow_test_ms");
  const parsed = typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_TEST_MS;
};

export const coverageRedundant = (runtime: Runtime, root: AbsolutePath, config: ConfigTree): readonly Redundant[] => {
  const file = configAt(config, "test_budget", "coverage");
  const text = typeof file === "string" ? runtime.readText(toAbsolutePath(join(root, file))) : undefined;
  const coverage = text?.ok === true ? parseJsonObject(text.value) : undefined;
  return coverage?.ok === true
    ? redundantTests(parseCoverage(coverage.value), configList(config, "test_budget", "keep"))
    : [];
};

const plain = (finding: BudgetFinding): Finding => ({
  id: finding.id,
  check: finding.check,
  rule: finding.rule,
  file: finding.file,
  line: finding.line,
  fingerprint: finding.fingerprint,
});

export const budgetFindings = (runtime: Runtime, root: AbsolutePath): readonly Finding[] => {
  const config = loadProjectConfig(runtime, root);
  const tests = readDurations(runtime, fmPaths(root))?.tests ?? [];
  return [
    ...slowTestFindings(tests, slowTestLimit(config)),
    ...redundantFindings(coverageRedundant(runtime, root, config)),
  ].map(plain);
};
