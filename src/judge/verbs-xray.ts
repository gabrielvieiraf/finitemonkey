import { bandSnapshot, claimsIn, supportStateOf, touchedConcepts } from "./claims.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import { answerOf, keyOf, probesIn, twoSpans } from "./probe.js";
import type { JudgeRequest } from "./request.js";
import { type JudgeResponse, type ProbeView, response, rowOf } from "./response.js";
import { entryId, readEntries } from "./store.js";
import type { JudgeEntry, ProbeEntry } from "./types.js";

type Request<V extends JudgeRequest["verb"]> = Extract<JudgeRequest, { verb: V }>;

export const probeView = (probe: ProbeEntry, entries: readonly JudgeEntry[]): ProbeView => {
  const answer = answerOf(probe.id, entries);
  return {
    probe: probe.id,
    claim: probe.claim,
    form: probe.form,
    prompt: probe.prompt,
    options: probe.options,
    answered: answer !== undefined,
    ...(answer === undefined ? {} : { correct: answer === "right" }),
    ...(answer === "wrong" ? { span: probe.options[probe.key] ?? "" } : {}),
  };
};

export const openProbe = (claim: string, entries: readonly JudgeEntry[]): ProbeEntry | undefined =>
  probesIn(entries).find((probe) => probe.claim === claim && answerOf(probe.id, entries) === undefined);

export const shownProbe = (
  verb: "judge" | "answer",
  id: string,
  deps: JudgeDeps,
  extra: Partial<JudgeResponse> = {},
): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const probe = probesIn(entries).find((item) => item.id === id);
  return probe === undefined
    ? response(verb, { reason: "write_failed" })
    : response(verb, { ...extra, probe: probeView(probe, entries) });
};

export const judgeThis = (deps: JudgeDeps, request: Request<"judge">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("judge", { reason: "unknown_claim" });
  const open = openProbe(claim.id, entries);
  if (open !== undefined) return response("judge", { probe: probeView(open, entries) });
  const key = keyOf(claim, entries);
  if (key === undefined) return response("judge", { reason: "no_key" });
  const id = entryId("p", claim.id, key.hash, deps.runtime.now());
  const written = appendNow(deps, {
    type: "probe",
    id,
    ...twoSpans(claim, key, touchedConcepts(claim, entries)),
    decision: request.decision,
    task: request.task,
  });
  return written.ok ? shownProbe("judge", id, deps, { entry: id }) : response("judge", { reason: written.reason });
};

const right = (deps: JudgeDeps, probe: ProbeEntry, entries: readonly JudgeEntry[]): void => {
  appendNow(deps, {
    type: "evidence",
    id: entryId("e", probe.id, "right"),
    concepts: probe.concepts,
    proof: "probe",
    result: "pass",
    ref: `probe:${probe.id}`,
    origin: "person",
    claim: probe.claim,
  });
  const claim = claimsIn(entries).find((item) => item.id === probe.claim);
  if (claim === undefined || supportStateOf(claim.id, entries) !== "model-only") return;
  appendNow(deps, {
    type: "support",
    id: entryId("s", claim.id, "person", probe.id),
    claim: claim.id,
    state: "person-judged",
    by: "person",
    ref: probe.keyHash,
    outcome: "keyed-answer",
    bands: bandSnapshot(claim, readEntries(deps.runtime, deps.paths)),
  });
};

export const answer = (deps: JudgeDeps, request: Request<"answer">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const probe = probesIn(entries).find((item) => item.id === request.probe);
  if (probe === undefined) return response("answer", { reason: "unknown_probe" });
  if (answerOf(probe.id, entries) !== undefined) return response("answer", { reason: "answered" });
  if (request.choice === probe.key) {
    right(deps, probe, entries);
    return shownProbe("answer", probe.id, deps);
  }
  appendNow(deps, {
    type: "signal",
    id: entryId("g", probe.id, "wrong"),
    family: "probe-wrong",
    confidence: 0,
    state: "shadow",
    ref: `probe:${probe.id}`,
  });
  return shownProbe("answer", probe.id, deps, { route: "verify" });
};

export const cut = (deps: JudgeDeps, request: Request<"cut">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("cut", { reason: "unknown_claim" });
  const written = appendNow(deps, {
    type: "support",
    id: entryId("s", claim.id, "cut", deps.runtime.now()),
    claim: claim.id,
    state: "retracted",
    by: "machine",
    outcome: "cut",
  });
  if (!written.ok) return response("cut", { reason: written.reason });
  const row = rowOf(claim.id, readEntries(deps.runtime, deps.paths));
  return row === undefined
    ? response("cut", {})
    : response("cut", { claim: { claim: row.claim, text: row.text, state: row.state, outcome: "cut" } });
};
