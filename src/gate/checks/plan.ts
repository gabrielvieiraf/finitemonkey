import { checkPlan } from "../../plan/check.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

export const planCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const result = checkPlan(ctx.runtime, ctx.paths.root);
  if (result.issues.length === 0) return passed([note("gate.plan.clean", { count: result.reports })]);
  return failed(
    result.issues
      .slice(0, MAX_LISTED)
      .map((item) => note(`plan.issue.${item.kind}`, { detail: `${item.file}:${String(item.line)} ${item.detail}` })),
  );
};
