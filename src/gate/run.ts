import { nowMs } from "../core/clock.js";
import { appendEvidence, latestFor, readLedger } from "../evidence/ledger.js";
import { type Evidence, EVIDENCE_SCHEMA, GATE_CHECK } from "../evidence/types.js";
import type { AcceptanceCheck } from "../task/types.js";
import { DEFAULT_CHECKS } from "./checks/index.js";
import { type GateFailure, type GateOptions, type GateSkip, type Prepared, prepareGate } from "./prepare.js";
import { buildReport, type GateReport, verdictOf } from "./report.js";
import { type CheckOutcome, type CheckRegistry, type GateContext, note, REUSABLE_KINDS, unverified } from "./types.js";

export const FAST_PATH_MS = 10 * 60_000;

export type GateRun =
  | { readonly kind: "skipped"; readonly reason: GateSkip }
  | { readonly kind: "failed"; readonly failure: GateFailure | { readonly kind: "ledger_unwritable" } }
  | { readonly kind: "done"; readonly report: GateReport };

const toEvidence = (ctx: GateContext, check: AcceptanceCheck, outcome: CheckOutcome): Evidence => ({
  schema: EVIDENCE_SCHEMA,
  task: ctx.contract.id,
  check: check.id,
  kind: check.kind,
  treeHash: ctx.treeHash,
  at: ctx.runtime.now(),
  ...outcome,
  ...(check.run === undefined || outcome.command !== undefined ? {} : { command: check.run }),
});

const reusable = (ledger: readonly Evidence[], ctx: GateContext, check: AcceptanceCheck): boolean => {
  if (!REUSABLE_KINDS.includes(check.kind)) return false;
  const prior = latestFor(
    ledger.filter((entry) => entry.task === ctx.contract.id),
    check.id,
    ctx.treeHash,
    check.run,
  );
  return prior !== undefined && prior.status !== "unverified";
};

const notImplemented = (check: AcceptanceCheck): CheckOutcome =>
  unverified("not_implemented", [note("gate.note.not_implemented", { kind: check.kind })]);

export const runChecks = (
  ctx: GateContext,
  ledger: readonly Evidence[],
  registry: CheckRegistry,
): readonly Evidence[] =>
  ctx.contract.acceptance.flatMap((check) => {
    if (reusable(ledger, ctx, check)) return [];
    const runner = registry[check.kind];
    return [toEvidence(ctx, check, runner === undefined ? notImplemented(check) : runner(check, ctx))];
  });

const fastPathHit = (prepared: Prepared, ledger: readonly Evidence[]): boolean => {
  const { ctx, loaded } = prepared;
  const last = latestFor(
    ledger.filter((entry) => entry.task === ctx.contract.id),
    GATE_CHECK,
    ctx.treeHash,
  );
  return (
    last?.status === "passed" && last.command === loaded.hash && nowMs(ctx.runtime) - Date.parse(last.at) < FAST_PATH_MS
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

const summaryEntry = (prepared: Prepared, ledger: readonly Evidence[]): Evidence => {
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
  };
};

export const runGate = (options: GateOptions, registry: CheckRegistry = DEFAULT_CHECKS): GateRun => {
  const ready = prepareGate(options);
  if (ready.kind !== "ready") return ready;
  const { prepared } = ready;
  const path = prepared.ctx.paths.evidence(prepared.ctx.contract.id);
  const before = readLedger(options.runtime, path);
  if (options.fast && fastPathHit(prepared, before)) return { kind: "done", report: report(prepared, before, true) };
  const fresh = runChecks(prepared.ctx, before, registry);
  if (!appendEvidence(options.runtime, path, fresh)) return { kind: "failed", failure: { kind: "ledger_unwritable" } };
  const withChecks = readLedger(options.runtime, path);
  if (!appendEvidence(options.runtime, path, [summaryEntry(prepared, withChecks)])) {
    return { kind: "failed", failure: { kind: "ledger_unwritable" } };
  }
  return { kind: "done", report: report(prepared, readLedger(options.runtime, path), false) };
};
