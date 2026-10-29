import { apiOutcome } from "../../apicontract/gate-api.js";
import { contractCoverage, loadRegistry } from "../../apicontract/load.js";
import { CONTRACT_FEATURE } from "../../apicontract/registry.js";
import { guardMode } from "../../quality/gate-sources.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

const coverageOutcome = (ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, CONTRACT_FEATURE);
  if (mode === "off") return passed([note("gate.contract.off")]);
  const loaded = loadRegistry(ctx.runtime, ctx.paths.root);
  if (loaded.kind === "absent") return passed([note("gate.contract.no_registry")]);
  if (loaded.kind === "invalid") return failed([note("gate.contract.invalid", { issues: loaded.issues.join("; ") })]);
  const problems = contractCoverage(ctx.runtime, ctx.paths.root, loaded.registry);
  if (problems.length === 0) return passed([note("gate.contract.clean")]);
  const notes = problems.slice(0, MAX_LISTED).map((problem) => note(`gate.contract.${problem.kind}`, { ...problem }));
  return mode === "shadow"
    ? passed([note("gate.contract.shadow", { count: problems.length }), ...notes])
    : failed(notes);
};

export const contractCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const coverage = coverageOutcome(ctx);
  const api = apiOutcome(ctx);
  if (api.notes.length === 0) return coverage;
  const notes = [...coverage.notes, ...api.notes];
  return coverage.status === "failed" || api.blocking ? failed(notes) : passed(notes);
};
