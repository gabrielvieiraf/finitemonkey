import { checkCost } from "../../cost/check.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

export const costCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const result = checkCost(ctx.runtime, ctx.paths.root);
  if (result.files === 0) return failed([note("gate.cost.missing")]);
  if (result.issues.length === 0)
    return passed([note("cost.clean", { count: result.files, days: result.validityDays })]);
  return failed(
    result.issues.slice(0, MAX_LISTED).map((item) =>
      note(`cost.issue.${item.kind}`, {
        detail: `${item.file}:${String(item.line)} ${item.detail}`,
        days: result.validityDays,
      }),
    ),
  );
};
