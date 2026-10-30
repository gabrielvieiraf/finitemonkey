import { matchesAny } from "../../core/glob.js";
import { readApprovals } from "../../guards/release/grants.js";
import { inInferred, readInferred, scopeLabel } from "../../task/scope-infer.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { diffShape } from "../diff-shape.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

const inferredOutside = (ctx: GateContext): { readonly files: readonly string[]; readonly label: string } => {
  const scope = readInferred(ctx.runtime, ctx.paths);
  if (scope?.task !== ctx.contract.id || scope.dirs.length === 0) return { files: [], label: "" };
  return {
    files: ctx.changes.filter((change) => !inInferred(scope, change.path)).map((change) => change.path),
    label: scopeLabel(scope),
  };
};

const acceptedOutside = (ctx: GateContext, files: readonly string[]): CheckOutcome | undefined => {
  const approval = readApprovals(ctx.runtime, ctx.paths).findLast(
    (item) => item.task === ctx.contract.id && item.check === "diff",
  );
  if (approval === undefined) return undefined;
  return {
    status: "passed",
    notes: files.map((file) => note("gate.diff.accepted", { file, reason: approval.reason, at: approval.at })),
    releasedBy: `person@${approval.at}`,
  };
};

const inferredCheck = (ctx: GateContext): CheckOutcome => {
  const { files, label } = inferredOutside(ctx);
  if (label === "") return passed([note("gate.diff.no_scope")]);
  if (files.length === 0) return passed([note("gate.diff.inferred_within", { scope: label })]);
  return (
    acceptedOutside(ctx, files) ??
    failed(
      files
        .slice(0, MAX_LISTED)
        .map((file) => note("gate.diff.outside_inferred", { file, scope: label, task: ctx.contract.id })),
    )
  );
};

export const diffCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const { paths, diffBudget } = ctx.contract.scope;
  if (paths.length === 0 && diffBudget === undefined) return inferredCheck(ctx);
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
