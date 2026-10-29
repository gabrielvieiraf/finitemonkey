import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import {
  DEFAULT_VIOLATION_LIMIT,
  gitDriftInput,
  INSTRUCTION_DRIFT_FEATURE,
  instructionDrift,
} from "../instructions/drift.js";
import { isMuted, readBudget } from "../policy/budget.js";
import { featureMode } from "../policy/feature.js";
import { policyNumber } from "../policy/numbers.js";
import { loadPolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { diskReader } from "./anchor.js";
import { KNOWLEDGE_CLAIMS_FEATURE, readClaims } from "./claims.js";
import { claimLine, MAX_INJECTED } from "./hook.js";
import { withQuarantine } from "./quarantine.js";
import { withRetractions } from "./retraction.js";
import { injectable, viewsOf } from "./service.js";
import { type ClaimView, evaluateClaim } from "./status.js";

export interface KnowledgeCounts {
  readonly stale: number;
  readonly contradictions: number;
  readonly quarantined: number;
}

type CountRuntime = Pick<Runtime, "readText" | "exec" | "homeDir" | "listDir" | "stat" | "now">;

const contradictionsOf = (runtime: CountRuntime, paths: FmPaths): number => {
  if (featureMode(runtime, paths, INSTRUCTION_DRIFT_FEATURE) === "off") return 0;
  const violationLimit = policyNumber(runtime, paths.root, ["knowledge", "violationLimit"], DEFAULT_VIOLATION_LIMIT);
  return instructionDrift(gitDriftInput(runtime, paths.root, { conflicts: [], violationLimit })).filter(
    (finding) => finding.kind !== "contradiction" || !finding.proposal,
  ).length;
};

export const knowledgeCounts = (runtime: CountRuntime, paths: FmPaths): KnowledgeCounts | null => {
  const policy = loadPolicy(runtime, paths.root);
  if (isMuted(readBudget(runtime, paths), policy.alertBudget, nowMs(runtime), KNOWLEDGE_CLAIMS_FEATURE)) return null;
  const views = readClaims(runtime, paths).length === 0 ? [] : viewsOf(runtime, paths);
  const counts = {
    stale: views.filter((view) => view.status === "stale").length,
    contradictions: contradictionsOf(runtime, paths),
    quarantined: views.filter((view) => view.status === "quarantined").length,
  };
  return counts.stale + counts.contradictions + counts.quarantined === 0 ? null : counts;
};

export const compactionClaims = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "listDir">,
  paths: FmPaths,
): readonly ClaimView[] => {
  if (featureMode(runtime, paths, KNOWLEDGE_CLAIMS_FEATURE) !== "active") return [];
  const claims = readClaims(runtime, paths);
  if (claims.length === 0) return [];
  const read = diskReader(runtime, paths.root);
  const evaluated = claims.map((claim) => evaluateClaim(claim, { read, candidates: () => [] }));
  return injectable(withQuarantine(runtime, paths, withRetractions(runtime, paths, evaluated), false)).slice(
    0,
    MAX_INJECTED,
  );
};

export const compactionClaimLines = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "listDir">,
  paths: FmPaths,
  t: Translate,
  tree: string | null,
): readonly string[] => {
  const views = compactionClaims(runtime, paths);
  return views.length === 0
    ? []
    : [t("handoff.claims", { tree: tree ?? "-" }), ...views.map((view) => claimLine(t, view))];
};
