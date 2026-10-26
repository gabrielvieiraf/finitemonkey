import type { Note } from "../../evidence/types.js";
import { findingLabel, mergeGateStatus, worktreeGateStatus } from "../../git/gate-status.js";
import { ownerKey } from "../../git/ownership.js";
import { openRepo, type Repo } from "../../git/repo.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 8;

const listed = (items: readonly string[]): string => {
  const head = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${head} (+${String(items.length - MAX_LISTED)})` : head;
};

const repoOf = (ctx: GateContext): Repo | undefined => openRepo(ctx.runtime, ctx.paths.root);

const ownerOf = (ctx: GateContext): string => ownerKey(ctx.sessionId);

const declaresDestination = (ctx: GateContext): boolean =>
  ctx.contract.acceptance.some((check) => check.kind === "git" && (check.require ?? []).includes("pushed"));

export const worktreeCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const repo = repoOf(ctx);
  if (repo === undefined) return unverified("tool_missing", [note("gate.worktree.unavailable")]);
  const status = worktreeGateStatus(ctx.runtime, repo, ownerOf(ctx));
  const unpushed = declaresDestination(ctx) ? [] : status.unpushed;
  const notes: Note[] = [
    ...(status.dirty.length > 0 ? [note("gate.worktree.dirty", { files: listed(status.dirty) })] : []),
    ...(unpushed.length > 0
      ? [note("gate.worktree.unpushed", { count: unpushed.length, branch: status.branch ?? "HEAD" })]
      : []),
  ];
  return notes.length > 0 ? failed(notes) : passed([note("gate.worktree.clean")]);
};

export const mergeCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const repo = repoOf(ctx);
  if (repo === undefined) return unverified("tool_missing", [note("gate.merge.unavailable")]);
  const items = mergeGateStatus(ctx.runtime, repo, ownerOf(ctx));
  const short = (commit: string): string => (commit === "MERGE_HEAD" ? commit : commit.slice(0, 12));
  const broken = items.filter((item) => item.report.exit === 2);
  if (broken.length > 0) {
    return unverified(
      "tool_missing",
      broken.map((item) =>
        note("gate.merge.unanalyzed", { commit: short(item.commit), detail: item.report.error ?? "" }),
      ),
    );
  }
  const lost = items.filter((item) => item.report.exit === 1);
  if (lost.length > 0) {
    return failed(
      lost.map((item) =>
        note("gate.merge.lost", {
          commit: short(item.commit),
          findings: listed(item.report.findings.map(findingLabel)),
        }),
      ),
    );
  }
  return passed([note("gate.merge.clean", { count: items.length })]);
};
