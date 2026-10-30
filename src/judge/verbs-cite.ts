import { sha256Hex } from "../secrets/fingerprint.js";
import { claimsIn, supportStateOf, touchedConcepts } from "./claims.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import { inputHash } from "./number-verify.js";
import type { JudgeRequest } from "./request.js";
import { conceptViews, type JudgeResponse, response } from "./response.js";
import { entryId, readEntries } from "./store.js";
import type { SupportEntry } from "./types.js";

const MATCHING: Readonly<Record<string, "verified" | "mismatch">> = {
  verified: "verified",
  "verified-weak": "verified",
  mismatch: "mismatch",
  unresolved: "mismatch",
};

export const personCheck = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "check" }>): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("check", { reason: "unknown_claim" });
  const machine = entries.findLast(
    (entry): entry is SupportEntry =>
      entry.type === "support" &&
      entry.claim === claim.id &&
      entry.by === "machine" &&
      entry.outcome !== undefined &&
      entry.outcome in MATCHING,
  );
  if (machine === undefined) return response("check", { reason: "not_checked" });
  const concepts = touchedConcepts(claim, entries);
  const id = entryId("e", claim.id, "source-check", machine.id);
  const written = appendNow(deps, {
    type: "evidence",
    id,
    concepts,
    proof: "source-check",
    result: MATCHING[machine.outcome ?? ""] === request.says ? "pass" : "fail",
    ref: machine.ref ?? machine.id,
    origin: "person",
    claim: claim.id,
  });
  if (!written.ok) return response("check", { reason: written.reason });
  return response("check", { entry: id, concepts: conceptViews(readEntries(deps.runtime, deps.paths), concepts) });
};

export const anchorCompute = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "anchor" }>): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("anchor", { reason: "unknown_claim" });
  const context = { runtime: deps.runtime, paths: deps.paths, entries };
  const inputs = request.inputs.map((input) => `${input}:${inputHash(context, input)}`);
  if (inputs.some((pair) => pair.endsWith(":missing"))) return response("anchor", { reason: "missing_input" });
  const id = entryId("s", claim.id, "anchor", request.run, inputs.join(","));
  const written = appendNow(deps, {
    type: "support",
    id,
    claim: claim.id,
    state: supportStateOf(claim.id, entries),
    by: "machine",
    outcome: "anchored-compute",
    anchors: [
      {
        kind: "compute",
        ref: request.run,
        hash: sha256Hex(`${request.run}\u0000${inputs.join(",")}`).slice(0, 16),
        inputs,
      },
    ],
  });
  return written.ok ? response("anchor", { entry: id }) : response("anchor", { reason: written.reason });
};
