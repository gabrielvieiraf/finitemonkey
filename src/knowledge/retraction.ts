import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { type Assumption, readAssumptions } from "../guardian/assumptions.js";
import { type DecisionEntry, readDecisions } from "../guardian/decisions.js";
import type { FmPaths } from "../task/paths.js";
import { appendClaimEvent, type Claim, lastOf } from "./claims.js";
import type { ClaimView } from "./status.js";

export const PREMISE_KINDS = ["claim", "evidence", "assumption"] as const;

export type PremiseKind = (typeof PREMISE_KINDS)[number];

export interface Premise {
  readonly kind: PremiseKind;
  readonly id: string;
}

export interface OutView {
  readonly subject: string;
  readonly reason: string;
}

export type RetractionRuntime = Pick<Runtime, "readText" | "homeDir">;

export const parsePremise = (ref: string): Premise | undefined => {
  const at = ref.indexOf(":");
  const kind = PREMISE_KINDS.find((item) => item === ref.slice(0, at));
  const id = ref.slice(at + 1);
  return at <= 0 || kind === undefined || id === "" ? undefined : { kind, id };
};

const evidenceOk = (runtime: RetractionRuntime, paths: FmPaths, id: string): boolean => {
  const [task = "", index = ""] = id.split(":");
  return readLedger(runtime, paths.evidence(task))[Number.parseInt(index, 10) - 1]?.status === "passed";
};

export const premiseExists = (
  runtime: RetractionRuntime,
  paths: FmPaths,
  claims: readonly Claim[],
  premise: Premise,
): boolean => {
  switch (premise.kind) {
    case "claim":
      return claims.some((claim) => claim.id === premise.id);
    case "assumption":
      return readAssumptions(runtime, paths).some((item) => item.id === premise.id);
    case "evidence": {
      const [task = "", index = ""] = premise.id.split(":");
      return readLedger(runtime, paths.evidence(task))[Number.parseInt(index, 10) - 1] !== undefined;
    }
  }
};

interface Graph {
  readonly views: ReadonlyMap<string, ClaimView>;
  readonly assumptions: ReadonlyMap<string, Assumption>;
  readonly evidence: (id: string) => boolean;
}

const premiseReason = (graph: Graph, premise: Premise, seen: ReadonlySet<string>): string | undefined => {
  switch (premise.kind) {
    case "assumption":
      return graph.assumptions.get(premise.id)?.status === "false" ? `assumption:${premise.id} refuted` : undefined;
    case "evidence":
      return graph.evidence(premise.id) ? undefined : `evidence:${premise.id} not passing`;
    case "claim": {
      const view = graph.views.get(premise.id);
      if (view === undefined) return `claim:${premise.id} unknown`;
      if (view.status !== "valid")
        return `claim:${premise.id} ${view.status}${view.reason === undefined ? "" : ` (${view.reason})`}`;
      const inner = outReason(graph, view.claim, seen);
      return inner === undefined ? undefined : `claim:${premise.id} out <- ${inner}`;
    }
  }
};

const outReason = (graph: Graph, claim: Claim, seen: ReadonlySet<string>): string | undefined => {
  if (seen.has(claim.id)) return undefined;
  const next = new Set([...seen, claim.id]);
  for (const ref of claim.because) {
    const premise = parsePremise(ref);
    const reason = premise === undefined ? undefined : premiseReason(graph, premise, next);
    if (reason !== undefined) return reason;
  }
  return undefined;
};

const sticky = (claim: Claim): string | undefined => {
  const last = lastOf(claim, ["out", "renew", "in"]);
  return last?.event === "out" ? (last.reason ?? "out") : undefined;
};

export const withRetractions = (
  runtime: RetractionRuntime,
  paths: FmPaths,
  views: readonly ClaimView[],
): readonly ClaimView[] => {
  const graph: Graph = {
    views: new Map(views.map((view) => [view.claim.id, view])),
    assumptions: new Map(readAssumptions(runtime, paths).map((item) => [item.id, item])),
    evidence: (id) => evidenceOk(runtime, paths, id),
  };
  return views.map((view): ClaimView => {
    if (view.status !== "valid") return view;
    const live = outReason(graph, view.claim, new Set());
    if (live !== undefined) return { ...view, status: "out", reason: live };
    const held = sticky(view.claim);
    return held === undefined
      ? view
      : { ...view, status: "out", reason: `${held}; waiting for its own check or renew` };
  });
};

export const settleRetractions = (
  runtime: RetractionRuntime & Pick<Runtime, "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  views: readonly ClaimView[],
): void => {
  for (const view of views) {
    if (view.status !== "out" || sticky(view.claim) !== undefined) continue;
    appendClaimEvent(runtime, paths, {
      event: "out",
      id: view.claim.id,
      recordedAt: runtime.now(),
      ...(view.reason === undefined ? {} : { reason: view.reason }),
    });
  }
};

const decisionPremises = (decision: DecisionEntry, assumptions: readonly Assumption[]): readonly Assumption[] =>
  assumptions.filter(
    (item) =>
      item.source === decision.id ||
      decision.evidence.includes(`assumption:${item.id}`) ||
      (item.source !== "" && decision.paths.includes(item.source)),
  );

export const outDecisions = (runtime: RetractionRuntime, paths: FmPaths): readonly OutView[] => {
  const assumptions = readAssumptions(runtime, paths);
  return readDecisions(runtime, paths).flatMap((decision) => {
    const refuted = decisionPremises(decision, assumptions).find((item) => item.status === "false");
    return refuted === undefined
      ? []
      : [{ subject: `decision:${decision.id}`, reason: `assumption:${refuted.id} refuted` }];
  });
};
