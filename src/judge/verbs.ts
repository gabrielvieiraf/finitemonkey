import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { bandSnapshot, claimIdOf, claimsIn, resultsIn, supportStateOf } from "./claims.js";
import { writeHandoff } from "./handoff.js";
import type { JudgeRequest } from "./request.js";
import { conceptViews, type JudgeResponse, response, resultView, resultViews } from "./response.js";
import { type ClaimSplitter, splitClaims } from "./split.js";
import { appendEntry, entryId, exportJudge, forgetJudge, readEntries } from "./store.js";
import type { JudgeClaimKind, JudgeEntry } from "./types.js";
import { DEFAULT_VERIFIERS, type SupportProposer, type Verifier, type VerifyRuntime } from "./verify.js";

export type JudgeRuntime = VerifyRuntime & Pick<Runtime, "appendText" | "mkdir" | "writeAtomic" | "remove">;

export interface JudgeDeps {
  readonly runtime: JudgeRuntime;
  readonly paths: FmPaths;
  readonly splitter?: ClaimSplitter;
  readonly proposer?: SupportProposer;
  readonly verifiers?: Readonly<Partial<Record<JudgeClaimKind, Verifier>>>;
}

const CITATION = /\b10\.\d{4,9}\/\S+|https?:\/\/\S+/i;
const QUOTED = /["“][^"”]{3,}["”]/;
const NUMBER = /\d/;

export const claimKindOf = (text: string): JudgeClaimKind => {
  if (QUOTED.test(text) && CITATION.test(text)) return "source-span";
  if (NUMBER.test(text)) return "number";
  return "prose";
};

const append = (deps: JudgeDeps, record: JsonObject): JudgeResponse | undefined => {
  const written = appendEntry(deps.runtime, deps.paths, { at: deps.runtime.now(), ...record });
  return written.ok ? undefined : response("observe", { reason: written.reason });
};

const observe = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "observe" }>): JudgeResponse => {
  const at = deps.runtime.now();
  const id = entryId("e", request.concepts.join(","), request.proof, request.ref ?? "", at);
  const record = { type: "evidence", id, origin: "agent", ...request, verb: undefined };
  const written = appendEntry(deps.runtime, deps.paths, { ...record, at });
  if (!written.ok) return response("observe", { reason: written.reason });
  return response("observe", {
    entry: id,
    concepts: conceptViews(readEntries(deps.runtime, deps.paths), request.concepts),
  });
};

const classify = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "classify" }>): JudgeResponse => {
  const before = readEntries(deps.runtime, deps.paths);
  const known = new Set(claimsIn(before).map((claim) => claim.id));
  const texts = splitClaims(request.text, deps.splitter);
  const ids = texts.map(claimIdOf);
  texts.forEach((text, index) => {
    const id = ids[index] ?? claimIdOf(text);
    if (known.has(id)) return;
    known.add(id);
    append(deps, { type: "claim", id, text, kind: claimKindOf(text), concepts: [], anchors: [], provenance: "model" });
  });
  const hash = sha256Hex(request.text).slice(0, 16);
  const resultId = entryId("r", request.file, hash);
  if (!resultsIn(before).some((result) => result.id === resultId))
    append(deps, {
      type: "result",
      id: resultId,
      source: request.file,
      hash,
      claims: ids,
      task: request.task,
      domain: request.domain,
    });
  const entries = readEntries(deps.runtime, deps.paths);
  const result = resultsIn(entries).find((item) => item.id === resultId);
  return result === undefined
    ? response("classify", { reason: "write_failed" })
    : response("classify", { result: resultView(result, entries) });
};

const verify = (deps: JudgeDeps, claimId: string): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === claimId);
  if (claim === undefined) return response("verify", { reason: "unknown_claim" });
  const proposed = deps.proposer?.(claim.text);
  const verifier = (deps.verifiers ?? DEFAULT_VERIFIERS)[claim.kind];
  const verdict = verifier?.(claim, { runtime: deps.runtime, paths: deps.paths, entries }) ?? {
    verified: false,
    outcome: "no-verifier",
  };
  const current = supportStateOf(claim.id, entries);
  if (verdict.verified || (verdict.outcome !== "no-verifier" && current === "model-only")) {
    append(deps, {
      type: "support",
      id: entryId("s", claim.id, verdict.outcome, deps.runtime.now()),
      claim: claim.id,
      state: verdict.verified ? "machine-verified" : current,
      by: "machine",
      outcome: verdict.outcome,
      ref: verdict.ref,
    });
  }
  const after = readEntries(deps.runtime, deps.paths);
  return response("verify", {
    claim: {
      claim: claim.id,
      text: claim.text,
      state: supportStateOf(claim.id, after),
      outcome: verdict.outcome,
      ...(proposed === undefined ? {} : { proposed }),
    },
  });
};

const ask = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "ask" }>): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  if (entries.some((entry) => entry.type === "ask" && entry.task === request.task))
    return response("ask", { reason: "one_per_task" });
  const id = entryId("q", request.task, request.decision);
  const failed = append(deps, { type: "ask", id, ...request, verb: undefined });
  if (failed !== undefined) return response("ask", { reason: failed.reason ?? "write_failed" });
  return response("ask", {
    entry: id,
    ask: { decision: request.decision, question: request.question, criterion: request.criterion },
  });
};

const handoff = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "handoff" }>): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("handoff", { reason: "unknown_claim" });
  const at = deps.runtime.now();
  const failed = append(deps, {
    type: "support",
    id: entryId("s", claim.id, "handoff", at),
    claim: claim.id,
    state: "handed-off",
    by: "machine",
    to: request.to,
    missing: request.missing,
    bands: bandSnapshot(claim, entries),
  });
  if (failed !== undefined) return response("handoff", { reason: failed.reason ?? "write_failed" });
  return response("handoff", { handoff: writeHandoff(deps, claim, entries, request, at) });
};

const contest = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "contest" }>): JudgeResponse => {
  const id = entryId("x", request.target, deps.runtime.now());
  const failed = append(deps, { type: "contest", id, target: request.target, reason: request.reason });
  return failed === undefined
    ? response("contest", { entry: id })
    : response("contest", { reason: failed.reason ?? "write_failed" });
};

const view = (entries: readonly JudgeEntry[], concept: string | undefined): JudgeResponse =>
  response("fade", { concepts: conceptViews(entries, concept === undefined ? undefined : [concept]) });

export const runVerb = (deps: JudgeDeps, request: JudgeRequest): JudgeResponse => {
  switch (request.verb) {
    case "observe":
      return observe(deps, request);
    case "classify":
      return classify(deps, request);
    case "verify":
      return verify(deps, request.claim);
    case "ask":
      return ask(deps, request);
    case "handoff":
      return handoff(deps, request);
    case "contest":
      return contest(deps, request);
    case "fade":
      return view(readEntries(deps.runtime, deps.paths), request.concept);
    case "report": {
      const entries = readEntries(deps.runtime, deps.paths);
      return response("report", { concepts: conceptViews(entries), results: resultViews(entries) });
    }
    case "export":
      return response("export", { export: exportJudge(deps.runtime, deps.paths) });
    case "forget":
      return response("forget", { removed: forgetJudge(deps.runtime, deps.paths, request.id) });
  }
};
