import type { AcceptanceCheck } from "../../task/types.js";
import { fileAt } from "../git.js";
import { APPROVING, readReviews, type Review } from "../review.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";
import { boundApproval } from "./approval.js";

const MAX_SENSITIVE = 5;

const sizeNotes = (ctx: GateContext): CheckOutcome["notes"] => {
  const size = ctx.size;
  if (size === undefined) return [];
  return [
    note(size.declared === size.effective ? "gate.size.declared" : "gate.size.grew", {
      declared: size.declared,
      effective: size.effective,
      files: size.files,
      lines: size.lines,
    }),
    ...size.sensitive.slice(0, MAX_SENSITIVE).map((file) => note("gate.size.sensitive", { file })),
  ];
};

const PLUGIN_PREFIX = "finitemonkey:";

export const trustedReviewer = (ctx: Pick<GateContext, "git" | "base" | "changes">, agent: string): boolean => {
  if (agent.startsWith(PLUGIN_PREFIX)) return true;
  if (agent.includes(":")) return false;
  const file = `.claude/agents/${agent}.md`;
  return fileAt(ctx.git, ctx.base, file) !== undefined && !ctx.changes.some((change) => change.path === file);
};

const fromReview = (review: Review): CheckOutcome => {
  const params = { agent: review.agent, at: review.at, verdict: review.verdict ?? "" };
  if (review.verdict === undefined) return unverified("no_verdict", [note("gate.review.no_verdict", params)]);
  if (APPROVING.has(review.verdict)) return passed([note("gate.review.done", params)]);
  return failed([note("gate.review.rejected", params)]);
};

export const reviewCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const bound = boundApproval(ctx, check.id);
  if (bound?.kind === "valid") {
    return {
      status: "passed",
      notes: [note("gate.manual.approved", { at: bound.approval.at, reason: bound.approval.reason })],
      releasedBy: `person@${bound.approval.at}`,
    };
  }
  const reviews = readReviews(ctx.runtime, ctx.paths).filter((entry) => entry.treeHash === ctx.treeHash);
  const trusted = reviews.filter((entry) => trustedReviewer(ctx, entry.agent));
  const latest = trusted[trusted.length - 1];
  if (latest !== undefined) return fromReview(latest);
  const ignored = [...new Set(reviews.map((entry) => entry.agent))]
    .slice(0, MAX_SENSITIVE)
    .map((agent) => note("gate.review.untrusted", { agent }));
  if (bound?.kind === "stale") {
    return unverified("needs_approval", [
      ...ignored,
      note("gate.approval.stale", { at: bound.approval.at, task: ctx.contract.id, check: check.id }),
    ]);
  }
  return failed([...sizeNotes(ctx), ...ignored, note("gate.review.missing", { check: check.id })]);
};
