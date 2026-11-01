import type { Grant } from "../../guards/release/grants.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, type GateContext, note, unverified } from "../types.js";
import { type BoundApproval, boundApproval } from "./approval.js";

export const TESTS_APPROVAL_CHECK = "tests";

export interface RewrittenTest {
  readonly file: string;
  readonly removed: number;
}

const MAX_LISTED = 10;

const approvalFor = (ctx: GateContext, check: AcceptanceCheck): BoundApproval | undefined => {
  const found = [...new Set([check.id, TESTS_APPROVAL_CHECK])]
    .map((id) => boundApproval(ctx, id))
    .filter((item): item is BoundApproval => item !== undefined);
  return found.find((item) => item.kind === "valid") ?? found[0];
};

const rewrittenNotes = (rewritten: readonly RewrittenTest[]) =>
  rewritten
    .slice(0, MAX_LISTED)
    .map((item) => note("gate.tests.rewritten", { file: item.file, removed: item.removed }));

export const holdRewrittenTests = (
  ctx: GateContext,
  check: AcceptanceCheck,
  rewritten: readonly RewrittenTest[],
  grant: Grant | undefined,
  outcome: CheckOutcome,
): CheckOutcome => {
  if (outcome.status !== "passed" || rewritten.length === 0 || grant !== undefined) return outcome;
  const task = ctx.contract.id;
  const bound = approvalFor(ctx, check);
  if (bound?.kind === "valid") {
    const { at, reason } = bound.approval;
    return {
      ...outcome,
      notes: [...outcome.notes, note("gate.tests.rewritten_approved", { at, reason })],
      releasedBy: `person@${at}`,
    };
  }
  if (bound?.kind === "stale") {
    return unverified("needs_approval", [
      ...rewrittenNotes(rewritten),
      note("gate.approval.stale", { at: bound.approval.at, task, check: bound.approval.check }),
    ]);
  }
  return unverified("awaiting_person", [
    ...outcome.notes,
    ...rewrittenNotes(rewritten),
    note("gate.tests.rewritten_fix"),
    note("gate.pin.approve", { task, check: TESTS_APPROVAL_CHECK }),
  ]);
};
