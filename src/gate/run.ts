import { nowMs } from "../core/clock.js";
import { appendEvidence, latestFor, readLedger } from "../evidence/ledger.js";
import { type Evidence, EVIDENCE_SCHEMA, type EvidenceInputs, GATE_CHECK } from "../evidence/types.js";
import { loadProjectConfig } from "../git/project-config.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import type { AcceptanceCheck } from "../task/types.js";
import { DEFAULT_CHECKS } from "./checks/index.js";
import { currentInputs, EVIDENCE_INPUTS_FEATURE, inputsConfig, staleReasons } from "./inputs.js";
import { type IsolatedFailure, withIsolatedTree } from "./isolated.js";
import { type GateFailure, type GateOptions, type GateSkip, type Prepared, prepareGate } from "./prepare.js";
import { buildReport, type GateReport, verdictOf } from "./report.js";
import { stateEntries } from "./state.js";
import { type CheckOutcome, type CheckRegistry, type GateContext, note, REUSABLE_KINDS, unverified } from "./types.js";

export const FAST_PATH_MS = 10 * 60_000;

export type GateRun =
  | { readonly kind: "skipped"; readonly reason: GateSkip }
  | {
      readonly kind: "failed";
      readonly failure: GateFailure | IsolatedFailure | { readonly kind: "ledger_unwritable" };
    }
  | { readonly kind: "done"; readonly report: GateReport };

export interface Freshness {
  readonly inputs: EvidenceInputs;
  readonly maxAgeMs: number;
  readonly mode: GuardMode;
}

export const freshnessFor = (ctx: GateContext): Freshness | undefined => {
  const mode = featureMode(ctx.runtime, ctx.paths, EVIDENCE_INPUTS_FEATURE);
  if (mode === "off") return undefined;
  const config = inputsConfig(loadProjectConfig(ctx.runtime, ctx.paths.root));
  return { inputs: currentInputs(ctx.runtime, ctx.paths.root, ctx.env, config), maxAgeMs: config.maxAgeMs, mode };
};

const toEvidence = (
  ctx: GateContext,
  check: AcceptanceCheck,
  outcome: CheckOutcome,
  freshness: Freshness | undefined,
): Evidence => ({
  schema: EVIDENCE_SCHEMA,
  task: ctx.contract.id,
  check: check.id,
  kind: check.kind,
  treeHash: ctx.treeHash,
  at: ctx.runtime.now(),
  ...outcome,
  ...(check.run === undefined || outcome.command !== undefined ? {} : { command: check.run }),
  ...(freshness === undefined ? {} : { inputs: freshness.inputs }),
});

const stillFresh = (ctx: GateContext, prior: Evidence, freshness: Freshness | undefined): boolean => {
  if (freshness === undefined) return true;
  const reasons = staleReasons(prior, {
    inputs: freshness.inputs,
    treeHash: ctx.treeHash,
    atMs: nowMs(ctx.runtime),
    maxAgeMs: freshness.maxAgeMs,
  });
  if (reasons.length === 0) return true;
  if (freshness.mode === "active") return false;
  recordFeatureShadow(ctx.runtime, ctx.paths, EVIDENCE_INPUTS_FEATURE, {
    check: prior.check,
    wouldHave: "rerun",
    changed: reasons.join(","),
  });
  return true;
};

const reusable = (
  ledger: readonly Evidence[],
  ctx: GateContext,
  check: AcceptanceCheck,
  freshness: Freshness | undefined,
): boolean => {
  if (!REUSABLE_KINDS.includes(check.kind)) return false;
  const prior = latestFor(
    ledger.filter((entry) => entry.task === ctx.contract.id),
    check.id,
    ctx.treeHash,
    check.run,
  );
  return prior !== undefined && prior.status !== "unverified" && stillFresh(ctx, prior, freshness);
};

const notImplemented = (check: AcceptanceCheck): CheckOutcome =>
  unverified("not_implemented", [note("gate.note.not_implemented", { kind: check.kind })]);

export const runChecks = (
  ctx: GateContext,
  ledger: readonly Evidence[],
  registry: CheckRegistry,
  freshness?: Freshness,
): readonly Evidence[] =>
  ctx.contract.acceptance.flatMap((check) => {
    if (reusable(ledger, ctx, check, freshness)) return [];
    const runner = registry[check.kind];
    return [toEvidence(ctx, check, runner === undefined ? notImplemented(check) : runner(check, ctx), freshness)];
  });

const fastPathHit = (prepared: Prepared, ledger: readonly Evidence[], freshness: Freshness | undefined): boolean => {
  const { ctx, loaded } = prepared;
  const last = latestFor(
    ledger.filter((entry) => entry.task === ctx.contract.id),
    GATE_CHECK,
    ctx.treeHash,
  );
  return (
    last?.status === "passed" &&
    last.command === loaded.hash &&
    nowMs(ctx.runtime) - Date.parse(last.at) < FAST_PATH_MS &&
    stillFresh(ctx, last, freshness)
  );
};

const report = (prepared: Prepared, ledger: readonly Evidence[], fastPath: boolean): GateReport =>
  buildReport({
    contract: prepared.ctx.contract,
    ledger,
    treeHash: prepared.ctx.treeHash,
    base: prepared.ctx.base,
    source: prepared.loaded.source,
    contractEdited: prepared.loaded.editedOnDisk,
    fastPath,
  });

const summaryEntry = (prepared: Prepared, ledger: readonly Evidence[], freshness: Freshness | undefined): Evidence => {
  const draft = report(prepared, ledger, false);
  return {
    schema: EVIDENCE_SCHEMA,
    task: prepared.ctx.contract.id,
    check: GATE_CHECK,
    kind: "gate",
    status:
      verdictOf(draft.items) === "passed" ? "passed" : verdictOf(draft.items) === "failed" ? "failed" : "unverified",
    treeHash: prepared.ctx.treeHash,
    at: prepared.ctx.runtime.now(),
    command: prepared.loaded.hash,
    notes: [],
    ...(freshness === undefined ? {} : { inputs: freshness.inputs }),
  };
};

const evaluate = (options: GateOptions, prepared: Prepared, registry: CheckRegistry, fast: boolean): GateRun => {
  const path = prepared.ctx.paths.evidence(prepared.ctx.contract.id);
  const before = readLedger(options.runtime, path);
  const freshness = freshnessFor(prepared.ctx);
  if (fast && fastPathHit(prepared, before, freshness)) return { kind: "done", report: report(prepared, before, true) };
  const fresh = runChecks(prepared.ctx, before, registry, freshness);
  if (!appendEvidence(options.runtime, path, fresh)) return { kind: "failed", failure: { kind: "ledger_unwritable" } };
  const withChecks = readLedger(options.runtime, path);
  const draft = report(prepared, withChecks, false);
  const states = stateEntries(
    withChecks,
    { task: prepared.ctx.contract.id, treeHash: prepared.ctx.treeHash, at: prepared.ctx.runtime.now() },
    { state: draft.state, reason: draft.stateReason },
  );
  if (!appendEvidence(options.runtime, path, [summaryEntry(prepared, withChecks, freshness), ...states])) {
    return { kind: "failed", failure: { kind: "ledger_unwritable" } };
  }
  return { kind: "done", report: report(prepared, readLedger(options.runtime, path), false) };
};

export const runGate = (options: GateOptions, registry: CheckRegistry = DEFAULT_CHECKS): GateRun => {
  const ready = prepareGate(options);
  if (ready.kind !== "ready") return ready;
  if (options.isolated !== true) return evaluate(options, ready.prepared, registry, options.fast);
  const isolated = withIsolatedTree(options.runtime, ready.prepared, (prepared) =>
    evaluate(options, prepared, registry, false),
  );
  return isolated.ok ? isolated.value : { kind: "failed", failure: isolated.error };
};
