import { readApprovals } from "../../guards/release/grants.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { readReviews } from "../review.js";
import { type CheckOutcome, failed, type GateContext, note } from "../types.js";

const MAX_SENSITIVE = 5;

const sizeNotes = (ctx: GateContext): CheckOutcome["notes"] => {
  const size = ctx.size;
  if (size === undefined) return [];
  return [
    note(size.declared === size.effective ? "gate.size.declared" : "gate.size.grew", {
      declared: size.declared,
      effective: size.effective,
      files: size.files,
      lines: size.lines,
    }),
    ...size.sensitive.slice(0, MAX_SENSITIVE).map((file) => note("gate.size.sensitive", { file })),
  ];
};

export const reviewCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const review = readReviews(ctx.runtime, ctx.paths).findLast((entry) => entry.treeHash === ctx.treeHash);
  if (review !== undefined) {
    return { status: "passed", notes: [note("gate.review.done", { agent: review.agent, at: review.at })] };
  }
  const approval = readApprovals(ctx.runtime, ctx.paths).findLast(
    (item) => item.task === ctx.contract.id && item.check === check.id,
  );
  if (approval !== undefined) {
    return {
      status: "passed",
      notes: [note("gate.manual.approved", { at: approval.at, reason: approval.reason })],
      releasedBy: `person@${approval.at}`,
    };
  }
  return failed([...sizeNotes(ctx), note("gate.review.missing", { check: check.id })]);
};
