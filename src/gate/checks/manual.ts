import { readApprovals } from "../../guards/release/grants.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, type GateContext, note, unverified } from "../types.js";

export const manualCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const approval = readApprovals(ctx.runtime, ctx.paths).findLast(
    (item) => item.task === ctx.contract.id && item.check === check.id,
  );
  if (approval === undefined) {
    return unverified("awaiting_person", [
      note("gate.manual.waiting", { description: check.description ?? "", task: ctx.contract.id, check: check.id }),
    ]);
  }
  return {
    status: "passed",
    notes: [note("gate.manual.approved", { at: approval.at, reason: approval.reason })],
    releasedBy: `person@${approval.at}`,
  };
};
