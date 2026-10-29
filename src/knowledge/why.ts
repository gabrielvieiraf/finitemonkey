import { readPrompts } from "../audit/log.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import type { FmPaths } from "../task/paths.js";
import { type Claim, readClaims } from "./claims.js";

export interface WhyStep {
  readonly depth: number;
  readonly label: string;
  readonly detail: string;
}

const MAX_DEPTH = 8;

const evidenceStep = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  ref: string,
  depth: number,
): WhyStep => {
  const [task = "", index = ""] = ref.split(":");
  const entry = readLedger(runtime, paths.evidence(task))[Number.parseInt(index, 10) - 1];
  return {
    depth,
    label: "evidence",
    detail:
      entry === undefined
        ? `${ref} (not in the ledger)`
        : `${ref} ${entry.check} ${entry.status} at tree ${entry.treeHash} (${entry.at})`,
  };
};

const promptStep = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  at: string,
  depth: number,
): WhyStep => {
  const found = readPrompts(runtime, paths).find((item) => item.at === at);
  return {
    depth,
    label: "prompt",
    detail: found === undefined ? `${at} (not in prompts.jsonl)` : `${at} ${found.text.slice(0, 120)}`,
  };
};

const claimSteps = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  claims: ReadonlyMap<string, Claim>,
  id: string,
  depth: number,
  seen: Set<string>,
): readonly WhyStep[] => {
  const claim = claims.get(id);
  if (claim === undefined || seen.has(id) || depth > MAX_DEPTH)
    return [{ depth, label: "claim", detail: `${id} (unknown)` }];
  seen.add(id);
  const from = claim.origin.derivedFrom;
  return [
    { depth, label: "claim", detail: `${claim.id} ${claim.text}` },
    {
      depth: depth + 1,
      label: "origin",
      detail: `${claim.origin.source} (${claim.origin.attributedTo}), recorded ${claim.recordedAt}`,
    },
    ...(from.commit === undefined ? [] : [{ depth: depth + 1, label: "commit", detail: from.commit }]),
    ...(from.session === undefined ? [] : [{ depth: depth + 1, label: "session", detail: from.session }]),
    ...(from.evidence === undefined ? [] : [evidenceStep(runtime, paths, from.evidence, depth + 1)]),
    ...(from.prompt === undefined ? [] : [promptStep(runtime, paths, from.prompt, depth + 1)]),
    ...claim.because.flatMap((ref) => {
      const [kind = "", rest = ""] = ref.split(/:(.*)/s);
      if (kind === "claim") return claimSteps(runtime, paths, claims, rest, depth + 1, seen);
      if (kind === "evidence") return [evidenceStep(runtime, paths, rest, depth + 1)];
      return [{ depth: depth + 1, label: kind, detail: rest }];
    }),
  ];
};

export const whyChain = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  id: string,
): readonly WhyStep[] => {
  const claims = new Map(readClaims(runtime, paths).map((claim) => [claim.id, claim]));
  return claimSteps(runtime, paths, claims, id, 0, new Set());
};
