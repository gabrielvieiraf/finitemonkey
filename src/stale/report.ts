import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { docFiles, readUnits } from "./docs.js";
import { closingPrs, type Milestone, readEmptyMilestones, readIssues } from "./github.js";
import { commitsIn, defaultRange, type UnclosedIssue, unclosedIssues } from "./release.js";
import { type IssueFact, resolveUnits, type StaleClaim } from "./resolve.js";
import { type CommandEntry, featureDefaults, localState } from "./state.js";
import { type Mention, staleMentions } from "./touched.js";

export const STALE_SCHEMA = "finitemonkey/stale@1";

export interface StaleReport {
  readonly schema: typeof STALE_SCHEMA;
  readonly mode: "shadow";
  readonly online: boolean;
  readonly docs: number;
  readonly claims: number;
  readonly unresolvedIssues: readonly number[];
  readonly stale: readonly StaleClaim[];
  readonly mentions: readonly Mention[];
  readonly range: string | null;
  readonly unclosedIssues: readonly UnclosedIssue[];
  readonly emptyMilestones: readonly Milestone[];
}

export interface StaleRequest {
  readonly online: boolean;
  readonly afterMerge: boolean;
  readonly range: string | undefined;
  readonly diff: string | undefined;
}

export type StaleOutcome =
  { readonly ok: true; readonly report: StaleReport } | { readonly ok: false; readonly detail: string };

type StaleRuntime = Pick<Runtime, "git" | "readText" | "exec">;

const withClosers = (
  runtime: StaleRuntime,
  root: AbsolutePath,
  stale: readonly StaleClaim[],
  issues: ReadonlyMap<number, IssueFact>,
): readonly StaleClaim[] =>
  stale.map((claim) => {
    if (claim.truth !== "issue_closed") return claim;
    const number = Number(claim.subject.slice(1));
    const by = closingPrs(runtime, root, number);
    if (by.length === 0 || issues.get(number) === undefined) return claim;
    const detail = by.map((pr) => `#${String(pr)}`).join(", ");
    return { ...claim, detail, evidence: `${claim.evidence} by ${detail}` };
  });

const afterMerge = (
  runtime: StaleRuntime,
  root: AbsolutePath,
  request: StaleRequest,
  issues: ReadonlyMap<number, IssueFact>,
): StaleOutcome | Pick<StaleReport, "range" | "unclosedIssues" | "emptyMilestones"> => {
  if (!request.afterMerge) return { range: null, unclosedIssues: [], emptyMilestones: [] };
  const range = request.range ?? defaultRange(runtime, root);
  const milestones = readEmptyMilestones(runtime, root);
  if (!milestones.ok) return { ok: false, detail: milestones.detail };
  return {
    range: range ?? null,
    unclosedIssues: unclosedIssues(commitsIn(runtime, root, range), issues),
    emptyMilestones: milestones.value,
  };
};

export const staleReport = (
  runtime: StaleRuntime,
  root: AbsolutePath,
  registry: readonly CommandEntry[],
  request: StaleRequest,
): StaleOutcome => {
  const online = request.online || request.afterMerge;
  const issues = online ? readIssues(runtime, root) : undefined;
  if (issues !== undefined && !issues.ok) return { ok: false, detail: issues.detail };
  const facts = issues?.value;
  const files = docFiles(runtime, root);
  const resolved = resolveUnits(readUnits(runtime, root, files), localState(runtime, root, registry, facts));
  const merged = afterMerge(runtime, root, request, facts ?? new Map());
  if ("ok" in merged) return merged;
  const features = new Set(featureDefaults().keys());
  return {
    ok: true,
    report: {
      schema: STALE_SCHEMA,
      mode: "shadow",
      online,
      docs: files.length,
      claims: resolved.claims,
      unresolvedIssues: resolved.unresolvedIssues,
      stale: facts === undefined ? resolved.stale : withClosers(runtime, root, resolved.stale, facts),
      mentions: request.diff === undefined ? [] : staleMentions(runtime, root, request.diff, features),
      ...merged,
    },
  };
};
