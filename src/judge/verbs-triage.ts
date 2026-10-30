import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { readRecords } from "../knowledge/decision-record.js";
import { bandSnapshot, claimsIn, supportStateOf } from "./claims.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import type { JudgeRequest } from "./request.js";
import { type JudgeResponse, response, rowOf } from "./response.js";
import { entryId, readEntries } from "./store.js";

export const decisionExists = (deps: JudgeDeps, decision: string): boolean => {
  if (readRecords(deps.runtime, deps.paths).some((record) => record.task === decision)) return true;
  if (decision.split(/[\\/]/).includes("..")) return false;
  return deps.runtime.readText(toAbsolutePath(join(deps.paths.root, decision))).ok;
};

export const reply = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "reply" }>): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("reply", { reason: "unknown_claim" });
  if (supportStateOf(claim.id, entries) !== "handed-off") return response("reply", { reason: "not_handed_off" });
  const written = appendNow(deps, {
    type: "support",
    id: entryId("s", claim.id, "reply", deps.runtime.now()),
    claim: claim.id,
    state: request.verdict === "holds" ? "person-judged" : "retracted",
    by: "person",
    outcome: `reply-${request.verdict}`,
    bands: bandSnapshot(claim, entries),
  });
  if (!written.ok) return response("reply", { reason: written.reason });
  const row = rowOf(claim.id, readEntries(deps.runtime, deps.paths));
  return row === undefined
    ? response("reply", {})
    : response("reply", {
        claim: { claim: row.claim, text: row.text, state: row.state, outcome: `reply-${request.verdict}` },
      });
};

export const depend = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "depend" }>): JudgeResponse => {
  const claims = claimsIn(readEntries(deps.runtime, deps.paths));
  const claim = claims.find((item) => item.id === request.claim);
  if (claim === undefined || !claims.some((item) => item.id === request.on))
    return response("depend", { reason: "unknown_claim" });
  const written = appendNow(deps, { ...claim, at: deps.runtime.now(), because: [request.on] });
  return written.ok ? response("depend", { entry: claim.id }) : response("depend", { reason: written.reason });
};
