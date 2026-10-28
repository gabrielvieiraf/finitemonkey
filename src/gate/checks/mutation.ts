import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import { type Mutant, planMutants } from "../../mutation/operators.js";
import { parseToolReport, TOOL_REPORT } from "../../mutation/report.js";
import { runMutants } from "../../mutation/run.js";
import { guardMode } from "../../quality/gate-sources.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { addedLines } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";
import { runShellCheck } from "./command.js";

export const MUTATION_FEATURE = "mutation";
export const DEFAULT_MIN_SCORE = 60;
export const MAX_MUTANTS = 12;
const MAX_LISTED = 10;

interface Tally {
  readonly killed: number;
  readonly survived: readonly Mutant[];
}

const survivorNote = (mutant: Mutant): Note =>
  note("gate.mutation.survived", { file: mutant.file, line: mutant.line, operator: mutant.operator });

const verdict = (check: AcceptanceCheck, ctx: GateContext, mode: string, tally: Tally): CheckOutcome => {
  const total = tally.killed + tally.survived.length;
  if (total === 0) return unverified("no_evidence", [note("gate.mutation.none_ran")]);
  const score = Math.round((tally.killed / total) * 100);
  const min = check.minScore ?? DEFAULT_MIN_SCORE;
  logEvent(ctx.runtime, ctx.paths, "mutation.score", { task: ctx.contract.id, mode, score, min, total });
  const listed = tally.survived.slice(0, MAX_LISTED).map(survivorNote);
  const summary = note("gate.mutation.score", { score, min, killed: tally.killed, total });
  if (score >= min) return passed([summary, ...listed]);
  if (mode === "shadow") return passed([summary, note("gate.mutation.shadow"), ...listed]);
  return failed([summary, ...listed, note("gate.mutation.fix")]);
};

const toolTally = (check: AcceptanceCheck, run: string, ctx: GateContext): Tally | CheckOutcome => {
  const outcome = runShellCheck({ ...check, kind: "command" }, run, ctx);
  if (outcome.status === "unverified") return outcome;
  const report = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, TOOL_REPORT)));
  const counts = report.ok ? parseToolReport(report.value) : undefined;
  return counts ?? unverified("tool_missing", [note("gate.mutation.no_report", { file: TOOL_REPORT })]);
};

const builtInTally = (ctx: GateContext): Tally | CheckOutcome => {
  const tests = ctx.contract.acceptance.find((item) => item.kind === "tests" && item.run !== undefined);
  if (tests?.run === undefined) return unverified("no_evidence", [note("gate.mutation.no_tests")]);
  const mutants = planMutants(addedLines(ctx.git, ctx.base), MAX_MUTANTS);
  if (mutants.length === 0) return passed([note("gate.mutation.no_mutants")]);
  const result = runMutants(ctx, tests, tests.run, mutants);
  if (result.kind === "baseline_failed") return unverified("no_evidence", [note("gate.mutation.baseline_failed")]);
  if (result.kind === "unavailable")
    return unverified("tool_missing", [note("gate.mutation.unavailable", { detail: ctx.mask(result.detail) })]);
  return { killed: result.killed.length, survived: result.survived };
};

const isTally = (value: Tally | CheckOutcome): value is Tally => "killed" in value;

export const mutationCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, MUTATION_FEATURE);
  if (mode === "off") return passed([note("gate.mutation.off")]);
  if (!ctx.trusted) return unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]);
  const tally = check.run === undefined ? builtInTally(ctx) : toolTally(check, check.run, ctx);
  return isTally(tally) ? verdict(check, ctx, mode, tally) : tally;
};
