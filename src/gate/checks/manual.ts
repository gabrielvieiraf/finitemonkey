import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, type GateContext, note, unverified } from "../types.js";
import { boundApproval } from "./approval.js";

export const manualCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const bound = boundApproval(ctx, check.id);
  if (bound === undefined) {
    return unverified("awaiting_person", [
      note("gate.manual.waiting", { description: check.description ?? "", task: ctx.contract.id, check: check.id }),
    ]);
  }
  if (bound.kind === "stale") {
    return unverified("needs_approval", [
      note("gate.approval.stale", { at: bound.approval.at, task: ctx.contract.id, check: check.id }),
    ]);
  }
  return {
    status: "passed",
    notes: [note("gate.manual.approved", { at: bound.approval.at, reason: bound.approval.reason })],
    releasedBy: `person@${bound.approval.at}`,
  };
};
