import { claimBand, claimsIn, conceptsIn, touchedConcepts } from "./claims.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import { answerOf, keyOf, probesIn, twoSpans } from "./probe.js";
import { type DistractorProposer, predictNumber, unsupportedClaim } from "./probe-forms.js";
import type { JudgeRequest } from "./request.js";
import { type JudgeResponse, response } from "./response.js";
import { entryId, readEntries } from "./store.js";
import type { ClaimEntry, JudgeEntry, ProbeEntry } from "./types.js";
import { shownProbe } from "./verbs-xray.js";

export const PROBES_FEATURE = "source-probes";
export const PROBE_BUDGET = { perSession: 1, perWeek: 5, perDomainWeek: 2 } as const;
const WEEK_MS = 7 * 86_400_000;

type Request<V extends JudgeRequest["verb"]> = Extract<JudgeRequest, { verb: V }>;

const routed = (entries: readonly JudgeEntry[]): readonly ProbeEntry[] =>
  probesIn(entries).filter((probe) => probe.decision !== undefined);

const domainsOf = (concepts: readonly string[], entries: readonly JudgeEntry[]): ReadonlySet<string> =>
  new Set(
    conceptsIn(entries)
      .filter((concept) => concepts.includes(concept.id))
      .map((concept) => concept.domain),
  );

export const overBudget = (
  entries: readonly JudgeEntry[],
  now: string,
  session: string | undefined,
  domains: ReadonlySet<string>,
): boolean => {
  const recent = routed(entries).filter((probe) => Date.parse(now) - Date.parse(probe.at) < WEEK_MS);
  if (session !== undefined && recent.filter((probe) => probe.session === session).length >= PROBE_BUDGET.perSession)
    return true;
  if (recent.length >= PROBE_BUDGET.perWeek) return true;
  return [...domains].some(
    (domain) =>
      recent.filter((probe) => domainsOf(probe.concepts, entries).has(domain)).length >= PROBE_BUDGET.perDomainWeek,
  );
};

const formFor = (
  deps: JudgeDeps,
  claim: ClaimEntry,
  entries: readonly JudgeEntry[],
  proposer: DistractorProposer | undefined,
): Omit<ProbeEntry, "id" | "at" | "type"> | undefined => {
  const key = keyOf(claim, entries);
  if (key === undefined) return undefined;
  const concepts = touchedConcepts(claim, entries);
  if (claim.kind === "number") {
    const number = predictNumber(claim, key, concepts);
    if (number !== undefined) return number;
  }
  const fetched = deps.fetcher?.(key.ref);
  const three =
    fetched?.status === "ok" ? unsupportedClaim(claim, key, fetched.content, concepts, proposer) : undefined;
  return three ?? twoSpans(claim, key, concepts);
};

export const routeProbe = (
  deps: JudgeDeps,
  request: Request<"probe">,
  proposer: DistractorProposer | undefined,
): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (claim === undefined) return response("probe", { reason: "unknown_claim" });
  const band = claimBand(claim, entries).band;
  if (band !== "no record" && band !== "beyond") return response("probe", { reason: "no_trigger" });
  const concepts = touchedConcepts(claim, entries);
  if (overBudget(entries, deps.runtime.now(), request.session, domainsOf(concepts, entries)))
    return response("probe", { reason: "budget" });
  const fields = formFor(deps, claim, entries, proposer);
  if (fields === undefined) return response("probe", { reason: "no_key" });
  const id = entryId("p", claim.id, request.decision, deps.runtime.now());
  const written = appendNow(deps, {
    type: "probe",
    id,
    ...fields,
    decision: request.decision,
    session: request.session,
    task: request.task,
  });
  return written.ok ? shownProbe("probe", id, deps, { entry: id }) : response("probe", { reason: written.reason });
};

export const skipProbe = (deps: JudgeDeps, request: Request<"skip">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const probe = probesIn(entries).find((item) => item.id === request.probe);
  if (probe === undefined) return response("skip", { reason: "unknown_probe" });
  if (answerOf(probe.id, entries) !== undefined) return response("skip", { reason: "answered" });
  appendNow(deps, {
    type: "signal",
    id: entryId("g", probe.id, "skip"),
    family: "probe-skip",
    confidence: 0,
    state: "shadow",
    ref: `skip:probe:${probe.id}`,
  });
  return shownProbe("skip", probe.id, deps);
};
