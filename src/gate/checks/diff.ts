import { matchesAny } from "../../core/glob.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { diffShape } from "../diff-shape.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

export const diffCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const { paths, diffBudget } = ctx.contract.scope;
  if (paths.length === 0 && diffBudget === undefined) return passed([note("gate.diff.no_scope")]);
  const outside = paths.length === 0 ? [] : ctx.changes.filter((change) => !matchesAny(change.path, paths));
  const files = ctx.changes.length;
  const lines = diffShape(ctx.runtime, ctx.git, ctx.base, ctx.changes).lines;
  const notes = [
    ...outside.slice(0, MAX_LISTED).map((change) => note("gate.diff.outside", { file: change.path })),
    ...(diffBudget?.files !== undefined && files > diffBudget.files
      ? [note("gate.diff.too_many_files", { count: files, max: diffBudget.files })]
      : []),
    ...(diffBudget?.lines !== undefined && lines > diffBudget.lines
      ? [note("gate.diff.too_many_lines", { count: lines, max: diffBudget.lines })]
      : []),
  ];
  return notes.length > 0 ? failed(notes) : passed([note("gate.diff.within", { files, lines })]);
};
