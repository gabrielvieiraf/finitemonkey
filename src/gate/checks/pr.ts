import type { Note } from "../../evidence/types.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { conflictFiles, type PrStatus } from "../pr.js";
import { isConflicting, type PrInfo } from "../pr-parse.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_FILES = 10;

const conflictNotes = (pr: PrInfo, ctx: GateContext): readonly Note[] => {
  const files = conflictFiles(ctx.git, pr.baseRefName);
  return [
    note("gate.pr.conflict", { number: pr.number, base: pr.baseRefName }),
    ...files.slice(0, MAX_FILES).map((file) => note("gate.pr.conflict_file", { file })),
    note("gate.pr.conflict_next", { base: pr.baseRefName }),
  ];
};

const foundOutcome = (status: Extract<PrStatus, { kind: "found" }>, ctx: GateContext): CheckOutcome => {
  const { pr } = status;
  const info: Note[] = [note("gate.pr.found", { number: pr.number, state: pr.state, url: pr.url })];
  if (pr.mergeStateStatus === "BEHIND") info.push(note("gate.pr.behind", { base: pr.baseRefName }));
  if (status.localHead !== undefined && pr.headRefOid !== "" && status.localHead !== pr.headRefOid) {
    info.push(note("gate.pr.stale_head", { number: pr.number }));
  }
  const failing = pr.checks.filter((check) => check.state === "failed");
  const pending = pr.checks.filter((check) => check.state === "pending");
  if (isConflicting(pr)) return failed([...info, ...conflictNotes(pr, ctx)]);
  if (failing.length > 0)
    return failed([...info, ...failing.map((check) => note("gate.pr.ci_failed", { name: check.name }))]);
  if (pending.length > 0)
    return unverified("pending", [
      ...info,
      ...pending.map((check) => note("gate.pr.ci_pending", { name: check.name })),
    ]);
  return passed(info);
};

export const prOutcome = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const status = ctx.pr();
  switch (status.kind) {
    case "no_gh":
      return unverified("no_gh", [note("gate.pr.no_gh")]);
    case "network":
      return unverified("network", [note("gate.pr.network", { detail: status.detail })]);
    case "no_branch":
      return unverified("not_implemented", [note("gate.pr.no_branch")]);
    case "none":
      return check.requireOpen === true
        ? failed([note("gate.pr.none_required", { branch: status.branch })])
        : passed([note("gate.pr.none", { branch: status.branch })]);
    case "found":
      return foundOutcome(status, ctx);
  }
};
