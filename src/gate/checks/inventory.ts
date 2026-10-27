import type { Note } from "../../evidence/types.js";
import { inventoryStates, type ReportState } from "../../inventory/expiry.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_PATHS = 5;

const noteOf = (state: ReportState): Note | undefined => {
  if (state.kind === "fresh") return undefined;
  if (state.kind === "unknown")
    return note("gate.inventory.unknown", { report: state.report, repo: state.repo, hash: state.hash });
  return note("gate.inventory.expired", {
    report: state.report,
    count: state.changed.length,
    hash: state.hash.slice(0, 12),
    paths: state.changed.slice(0, MAX_PATHS).join(", "),
    topic: state.topic,
  });
};

export const inventoryOutcome = (states: readonly ReportState[]): CheckOutcome => {
  if (states.length === 0) return failed([note("gate.inventory.missing")]);
  const notes = states.flatMap((state) => noteOf(state) ?? []);
  return notes.length === 0 ? passed([note("gate.inventory.fresh", { count: states.length })]) : failed(notes);
};

export const inventoryCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome =>
  inventoryOutcome(inventoryStates(ctx.runtime, ctx.paths.root));
