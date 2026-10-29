import { nowMs } from "../../core/clock.js";
import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import { anchorAt, diskReader } from "../../knowledge/anchor.js";
import { appendClaimEvent, type Claim, CLAIM_CHECKS_FEATURE, lastOf, readClaims } from "../../knowledge/claims.js";
import { planMutants } from "../../mutation/operators.js";
import { type Criterion, isDecorative, measureStrength } from "../../mutation/strength.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { addedLines } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";
import { MAX_MUTANTS } from "./mutation.js";

const CLAIM_TIMEOUT_MS = 60_000;
const MIN_REMAINING_MS = 1000;
const MAX_NOTES = 10;

export const touchedClaims = (claims: readonly Claim[], ctx: Pick<GateContext, "changes">): readonly Claim[] => {
  const touched = new Set(
    ctx.changes.flatMap((change) => [change.path, ...(change.oldPath === undefined ? [] : [change.oldPath])]),
  );
  return claims.filter(
    (claim) => lastOf(claim, ["close"]) === undefined && claim.anchors.some((anchor) => touched.has(anchor.path)),
  );
};

export const runClaim = (claim: Claim, at: GateContext): boolean | undefined => {
  const remaining = at.deadline - nowMs(at.runtime);
  if (claim.run === undefined || remaining < MIN_REMAINING_MS) return undefined;
  const result = at.runtime.exec({
    command: claim.run,
    args: [],
    cwd: at.paths.root,
    timeoutMs: Math.min(remaining, CLAIM_TIMEOUT_MS),
    shell: true,
    env: { CI: "1" },
    unset: ["NODE_TEST_CONTEXT"],
  });
  if (!result.found || result.timedOut) return undefined;
  return result.exitCode === 0;
};

const renew = (ctx: GateContext, claim: Claim): void => {
  const read = diskReader(ctx.runtime, ctx.paths.root);
  appendClaimEvent(ctx.runtime, ctx.paths, {
    event: "renew",
    id: claim.id,
    recordedAt: ctx.runtime.now(),
    tree: ctx.treeHash,
    reason: "check_passed",
    anchors: claim.anchors.flatMap((anchor) => {
      const text = read(anchor.path);
      return text === undefined ? [] : (anchorAt(text, anchor.path, anchor.symbol) ?? []);
    }),
  });
};

const decorative = (ctx: GateContext, checks: readonly Claim[]): readonly Note[] => {
  const files = new Set(checks.flatMap((claim) => claim.anchors.map((anchor) => anchor.path)));
  const mutants = planMutants(
    addedLines(ctx.git, ctx.base).filter((line) => files.has(line.path)),
    MAX_MUTANTS,
  );
  if (mutants.length === 0) return [];
  const criteria: readonly Criterion[] = checks.map((claim) => ({ id: claim.id, passes: (at) => runClaim(claim, at) }));
  const strength = measureStrength(ctx, criteria, mutants);
  if (strength.kind === "unavailable")
    return [note("gate.claims.strength_unavailable", { detail: ctx.mask(strength.detail) })];
  const empty = strength.criteria.filter(isDecorative).map((item) => item.id);
  logEvent(ctx.runtime, ctx.paths, "claims.strength", {
    task: ctx.contract.id,
    mutants: mutants.length,
    criteria: strength.criteria.map((item) => ({ id: item.id, killed: item.killed, measured: item.measured })),
    decorative: empty,
  });
  return empty.map((id) => note("gate.claims.decorative", { id, total: mutants.length }));
};

export const claimsCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, CLAIM_CHECKS_FEATURE);
  const relevant = touchedClaims(readClaims(ctx.runtime, ctx.paths), ctx);
  const prose = relevant.filter((claim) => claim.kind === "prose");
  const checks = relevant.filter((claim) => claim.kind === "check" && claim.run !== undefined);
  const proseNotes = prose.map((claim) => note("gate.claims.unverified", { id: claim.id, text: claim.text }));
  if (checks.length === 0) return passed([note("gate.claims.none"), ...proseNotes].slice(0, MAX_NOTES));
  if (!ctx.trusted) return unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]);
  const results = checks.map((claim) => ({ claim, ok: runClaim(claim, ctx) }));
  const broken = results.filter((item) => item.ok === false).map((item) => item.claim);
  const green = results.filter((item) => item.ok === true).map((item) => item.claim);
  for (const claim of green) renew(ctx, claim);
  for (const claim of broken)
    appendClaimEvent(ctx.runtime, ctx.paths, {
      event: "stale",
      id: claim.id,
      recordedAt: ctx.runtime.now(),
      reason: "check_failed",
      tree: ctx.treeHash,
    });
  const notes = [
    ...broken.map((claim) => note("gate.claims.failed", { id: claim.id, text: claim.text })),
    ...results
      .filter((item) => item.ok === undefined)
      .map((item) => note("gate.claims.not_run", { id: item.claim.id })),
    ...(green.length === 0 ? [] : [note("gate.claims.passed", { count: green.length })]),
    ...(broken.length === 0 ? decorative(ctx, green) : []),
    ...proseNotes,
  ].slice(0, MAX_NOTES);
  if (broken.length === 0) return passed(notes);
  if (mode === "active") return failed(notes);
  recordFeatureShadow(ctx.runtime, ctx.paths, CLAIM_CHECKS_FEATURE, {
    failed: broken.map((claim) => claim.id).join(","),
  });
  return passed([note("gate.claims.shadow"), ...notes].slice(0, MAX_NOTES));
};
