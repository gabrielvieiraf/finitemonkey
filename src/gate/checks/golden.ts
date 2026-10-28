import type { Note } from "../../evidence/types.js";
import { type CaseResult, evaluateCase, GOLDEN_FEATURE, type GoldenSpec, listCases } from "../../golden/cases.js";
import { guardMode } from "../../quality/gate-sources.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 5;

const specOf = (check: AcceptanceCheck): GoldenSpec | undefined =>
  check.run === undefined || check.cases === undefined
    ? undefined
    : { id: check.id, run: check.run, cases: check.cases, tolerance: check.tolerance ?? 0 };

const caseNote = (ctx: GateContext, result: CaseResult): Note | undefined => {
  switch (result.kind) {
    case "match":
      return undefined;
    case "missing":
      return note("gate.golden.missing", { case: result.name });
    case "exit":
      return note("gate.golden.exit", { case: result.name, code: result.exitCode ?? -1 });
    case "diff":
      return result.difference.kind === "number"
        ? note("gate.golden.number", { case: result.name, ...result.difference })
        : note("gate.golden.text", {
            case: result.name,
            line: result.difference.line,
            expected: ctx.mask(result.difference.expected),
            actual: ctx.mask(result.difference.actual),
          });
  }
};

export const goldenCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, GOLDEN_FEATURE);
  if (mode === "off") return passed([note("gate.golden.off")]);
  const spec = specOf(check);
  if (spec === undefined) return unverified("not_implemented", [note("gate.golden.no_spec")]);
  if (!ctx.trusted) return unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]);
  const names = listCases(ctx.runtime, ctx.paths.root, spec.cases);
  if (names.length === 0) return failed([note("gate.golden.no_cases", { dir: spec.cases })]);
  const results = names.map((name) => evaluateCase(ctx.runtime, ctx.paths.root, spec, name, ctx.deadline));
  const notes = results.flatMap((result) => caseNote(ctx, result) ?? []);
  if (notes.length === 0) return passed([note("gate.golden.clean", { count: names.length })]);
  const listed = [...notes.slice(0, MAX_LISTED), note("gate.golden.fix", { id: check.id })];
  return mode === "shadow" ? passed([note("gate.golden.shadow", { count: notes.length }), ...listed]) : failed(listed);
};
