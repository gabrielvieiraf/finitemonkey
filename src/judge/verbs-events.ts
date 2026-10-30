import { claimsIn, touchedConcepts } from "./claims.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import { claimSources, type ContradictionProposer, dependentsOf, eventsIn, snapshotAt } from "./events.js";
import type { JudgeRequest } from "./request.js";
import { type JudgeResponse, response } from "./response.js";
import { spanIn } from "./span.js";
import { entryId, readEntries } from "./store.js";
import type { ClaimEntry, EventCause, EventState, JudgeEntry } from "./types.js";

type Request<V extends JudgeRequest["verb"]> = Extract<JudgeRequest, { verb: V }>;

interface Opening {
  readonly cause: EventCause;
  readonly state: EventState;
  readonly sources: readonly string[];
}

const openEvent = (deps: JudgeDeps, claim: ClaimEntry, entries: readonly JudgeEntry[], opening: Opening): string => {
  const snapshot = snapshotAt(claim, entries);
  const id = entryId("v", claim.id, opening.cause, deps.runtime.now());
  appendNow(deps, { type: "event", id, claim: claim.id, ...opening, support: snapshot.support, bands: snapshot.bands });
  if (opening.state === "open")
    appendNow(deps, {
      type: "evidence",
      id: entryId("e", id, "failure"),
      concepts: touchedConcepts(claim, entries),
      proof: "failure-after-acceptance",
      result: "fail",
      ref: id,
      origin: "tool",
      claim: claim.id,
    });
  return id;
};

const listed = (verb: Request<"retract" | "failed" | "contradict" | "fixed" | "trajectory">["verb"], deps: JudgeDeps) =>
  response(verb, { events: eventsIn(readEntries(deps.runtime, deps.paths)) });

export const retract = (deps: JudgeDeps, request: Request<"retract">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("retract", { reason: "unknown_claim" });
  for (const item of [claim, ...dependentsOf(claim.id, entries)]) {
    openEvent(deps, item, entries, { cause: "retracted", state: "open", sources: claimSources(item, entries) });
    appendNow(deps, {
      type: "support",
      id: entryId("s", item.id, "retracted", deps.runtime.now()),
      claim: item.id,
      state: "retracted",
      by: "person",
      outcome: item.id === claim.id ? "retracted" : `retracted-with:${claim.id}`,
    });
  }
  return listed("retract", deps);
};

export const failedInUse = (deps: JudgeDeps, request: Request<"failed">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("failed", { reason: "unknown_claim" });
  openEvent(deps, claim, entries, { cause: "failed-in-use", state: "open", sources: claimSources(claim, entries) });
  return listed("failed", deps);
};

export const contradict = (deps: JudgeDeps, request: Request<"contradict">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("contradict", { reason: "unknown_claim" });
  const sources = [...claimSources(claim, entries), request.source];
  if (request.scope) {
    openEvent(deps, claim, entries, { cause: "contradicted", state: "pending", sources });
    return listed("contradict", deps);
  }
  const fetched = deps.fetcher?.(request.source);
  const matched = fetched?.status === "ok" && spanIn(request.span, fetched.content);
  if (!matched && !request.confirmed) return response("contradict", { reason: "no_span_match" });
  openEvent(deps, claim, entries, { cause: "contradicted", state: "open", sources });
  return listed("contradict", deps);
};

export const fixed = (deps: JudgeDeps, request: Request<"fixed">): JudgeResponse => {
  const event = eventsIn(readEntries(deps.runtime, deps.paths)).find((item) => item.id === request.event);
  if (event === undefined) return response("fixed", { reason: "unknown_event" });
  appendNow(deps, {
    ...event,
    at: deps.runtime.now(),
    fixedBy: request.by,
    state: request.by === "person" ? "held" : event.state,
  });
  return listed("fixed", deps);
};

export const trajectory = (deps: JudgeDeps): JudgeResponse => listed("trajectory", deps);

export const proposeContradictions = (
  deps: JudgeDeps,
  claim: string,
  proposer: ContradictionProposer | undefined,
): readonly { readonly source: string; readonly span: string }[] => {
  const entries = readEntries(deps.runtime, deps.paths);
  const found = claimsIn(entries).find((item) => item.id === claim);
  return found === undefined ? [] : (proposer?.(found.text) ?? []);
};
