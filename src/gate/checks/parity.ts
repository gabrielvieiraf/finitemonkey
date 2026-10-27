import { checkParity } from "../../parity/check.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

export const parityCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const result = checkParity(ctx.runtime, ctx.paths.root);
  if (result.issues.length === 0) return passed([note("parity.clean", { count: result.rows })]);
  return failed(
    result.issues
      .slice(0, MAX_LISTED)
      .map((item) =>
        note(`parity.issue.${item.kind}`, { detail: `${result.file}:${String(item.line)} ${item.detail}` }),
      ),
  );
};
