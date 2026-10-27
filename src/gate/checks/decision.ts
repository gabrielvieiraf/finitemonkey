import { checkDecisions } from "../../decide/check.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

export const decisionCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const result = checkDecisions(ctx.runtime, ctx.paths.root);
  if (result.records === 0) return failed([note("gate.decision.missing")]);
  if (result.issues.length === 0) return passed([note("decision.clean", { count: result.records })]);
  return failed(
    result.issues
      .slice(0, MAX_LISTED)
      .map((item) =>
        note(`decision.issue.${item.kind}`, { detail: `${item.file}:${String(item.line)} ${item.detail}` }),
      ),
  );
};
