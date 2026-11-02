import { dirname, join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { readLedger } from "../../evidence/ledger.js";
import type { Note } from "../../evidence/types.js";
import { loadBaseline, ratchetFor } from "../../findings/baseline.js";
import { configAt, loadProjectConfig } from "../../git/project-config.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { DEFAULT_TOLERANCE, slowSuite, suiteRuns, TEST_BUDGET_FEATURE } from "../../testbudget/budget.js";
import { readDurations } from "../../testbudget/durations.js";
import {
  type BudgetFinding,
  coverageRedundant,
  redundantFindings,
  slowTestFindings,
  slowTestLimit,
  TEST_BUDGET_CHECK,
} from "../../testbudget/findings.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

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

const findingNote = (finding: BudgetFinding, limit: number): Note =>
  finding.other === undefined
    ? note("gate.test_budget.slow_test", { test: finding.test, ms: finding.ms ?? 0, limit, id: finding.id })
    : note("gate.test_budget.redundant", { test: finding.test, other: finding.other, id: finding.id });

const currentFindings = (ctx: GateContext, limit: number): readonly BudgetFinding[] => {
  const durations = readDurations(ctx.runtime, ctx.paths);
  const tests = durations?.treeHash === ctx.treeHash ? durations.tests : [];
  const config = loadProjectConfig(ctx.runtime, ctx.paths.root);
  return [
    ...slowTestFindings(tests, limit),
    ...redundantFindings(coverageRedundant(ctx.runtime, ctx.paths.root, config)),
  ];
};

export const testBudgetCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, TEST_BUDGET_FEATURE);
  if (mode === "off") return passed([note("gate.test_budget.off")]);
  const baseline = loadBaseline(ctx.runtime, ctx.paths.root);
  if (!baseline.ok)
    return unverified("tool_missing", [note("gate.test_budget.baseline_invalid", { detail: baseline.error })]);
  const config = loadProjectConfig(ctx.runtime, ctx.paths.root);
  const slow = slowSuite(suiteRuns(allLedgers(ctx)), toleranceOf(configAt(config, "test_budget", "tolerance")));
  const limit = slowTestLimit(config);
  const ratchet = ratchetFor(
    TEST_BUDGET_CHECK,
    currentFindings(ctx, limit),
    baseline.value,
    ctx.runtime.now(),
    undefined,
  );
  const blocking = [...ratchet.fresh, ...ratchet.expired];
  const known = ratchet.known.length > 0 ? [note("gate.test_budget.known", { count: ratchet.known.length })] : [];
  const notes = [
    ...(slow === undefined
      ? []
      : [note("gate.test_budget.slow", { current: slow.currentMs, base: slow.baseMs, runs: slow.runs })]),
    ...blocking.slice(0, MAX_LISTED).map((finding) => findingNote(finding, limit)),
  ];
  if (notes.length === 0) return passed([note("gate.test_budget.ok"), ...known]);
  if (mode === "shadow") return passed([note("gate.test_budget.shadow"), ...notes, ...known]);
  return failed([...notes, ...known]);
};
