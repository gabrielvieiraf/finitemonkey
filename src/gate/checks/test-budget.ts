import { dirname, join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { parseJsonObject } from "../../core/parsed.js";
import { readLedger } from "../../evidence/ledger.js";
import { configAt, configList, loadProjectConfig } from "../../git/project-config.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import {
  DEFAULT_TOLERANCE,
  parseCoverage,
  redundantTests,
  slowSuite,
  suiteRuns,
  TEST_BUDGET_FEATURE,
} from "../../testbudget/budget.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

const allLedgers = (ctx: GateContext) => {
  const dir = toAbsolutePath(dirname(ctx.paths.evidence(ctx.contract.id)));
  const listed = ctx.runtime.listDir(dir);
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".jsonl")) : [];
  return files.flatMap((name) => readLedger(ctx.runtime, toAbsolutePath(join(dir, name))));
};

const toleranceOf = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOLERANCE;
};

export const testBudgetCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, TEST_BUDGET_FEATURE);
  if (mode === "off") return passed([note("gate.test_budget.off")]);
  const config = loadProjectConfig(ctx.runtime, ctx.paths.root);
  const slow = slowSuite(suiteRuns(allLedgers(ctx)), toleranceOf(configAt(config, "test_budget", "tolerance")));
  const coverageFile = configAt(config, "test_budget", "coverage");
  const coverageText =
    typeof coverageFile === "string"
      ? ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, coverageFile)))
      : undefined;
  const coverage = coverageText?.ok === true ? parseJsonObject(coverageText.value) : undefined;
  const redundant =
    coverage?.ok === true
      ? redundantTests(parseCoverage(coverage.value), configList(config, "test_budget", "keep"))
      : [];
  const notes = [
    ...(slow === undefined
      ? []
      : [note("gate.test_budget.slow", { current: slow.currentMs, base: slow.baseMs, runs: slow.runs })]),
    ...redundant
      .slice(0, MAX_LISTED)
      .map((item) => note("gate.test_budget.redundant", { test: item.test, other: item.coveredBy })),
  ];
  if (notes.length === 0) return passed([note("gate.test_budget.ok")]);
  if (mode === "shadow") return passed([note("gate.test_budget.shadow"), ...notes]);
  return slow === undefined ? passed(notes) : failed(notes);
};
