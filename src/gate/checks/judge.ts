import type { SourceHash } from "../../evidence/types.js";
import { resultsIn } from "../../judge/claims.js";
import { sourcesUsed } from "../../judge/gate.js";
import { resultView } from "../../judge/response.js";
import { readEntries } from "../../judge/store.js";
import { JUDGE_FEATURE, type JudgeEntry } from "../../judge/types.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, type GateContext, note, passed, unverified } from "../types.js";

const MAX_NOTES = 10;

const withSources = (outcome: CheckOutcome, sources: readonly SourceHash[]): CheckOutcome =>
  sources.length === 0 ? outcome : { ...outcome, sources };

const judgeOutcome = (entries: readonly JudgeEntry[], ctx: GateContext): CheckOutcome => {
  const views = resultsIn(entries)
    .filter((result) => result.task === ctx.contract.id)
    .map((result) => resultView(result, entries));
  const open = views.flatMap((view) =>
    view.rows
      .filter((row) => row.state === "model-only" || row.state === "handed-off")
      .map((row) => ({ source: view.source, row })),
  );
  if (open.length === 0) return passed([note("gate.judge.none")]);
  const notes = open.map(({ source, row }) =>
    note("gate.judge.model_only", { source, claim: row.claim, band: row.band, text: row.text }),
  );
  const mode = featureMode(ctx.runtime, ctx.paths, JUDGE_FEATURE);
  if (mode === "active")
    return unverified("no_verdict", [note("gate.judge.count", { count: open.length }), ...notes].slice(0, MAX_NOTES));
  if (mode === "shadow") recordFeatureShadow(ctx.runtime, ctx.paths, JUDGE_FEATURE, { modelOnly: open.length });
  return passed([note("gate.judge.shadow", { count: open.length }), ...notes].slice(0, MAX_NOTES));
};

export const judgeCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const entries = readEntries(ctx.runtime, ctx.paths);
  return withSources(judgeOutcome(entries, ctx), sourcesUsed(entries, ctx.contract.id));
};
