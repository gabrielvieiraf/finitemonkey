import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { checkDecisionText } from "../decide/check.js";
import type { FmPaths } from "../task/paths.js";
import { type DecisionEntry, readDecisions } from "./decisions.js";
import { commitsSince, type Outcome, outcomeOf } from "./outcomes.js";

export const GUARDIAN_REVIEW_SCHEMA = "finitemonkey/guardian-review@1";

export interface ProcessQuality {
  readonly criteriaFirst: boolean;
  readonly evidence: number;
}

export interface ReviewRow {
  readonly id: string;
  readonly source: DecisionEntry["source"];
  readonly subject: string;
  readonly at: string;
  readonly decision: DecisionEntry["decision"];
  readonly overrideReason?: string;
  readonly process: ProcessQuality;
  readonly outcome: Outcome;
}

export interface FollowedTally {
  readonly decisions: number;
  readonly reverted: number;
}

export interface GuardianReview {
  readonly schema: typeof GUARDIAN_REVIEW_SCHEMA;
  readonly rows: readonly ReviewRow[];
  readonly followed: FollowedTally;
  readonly overridden: FollowedTally;
}

const processOf = (runtime: Pick<Runtime, "readText">, paths: FmPaths, entry: DecisionEntry): ProcessQuality => {
  if (entry.source === "report")
    return { criteriaFirst: entry.criterion !== undefined, evidence: entry.evidence.length };
  const text = runtime.readText(toAbsolutePath(entry.subject, paths.root));
  const issues = text.ok ? checkDecisionText(entry.subject, text.value).map((item) => item.kind) : ["missing_sections"];
  const criteriaFirst = !issues.some(
    (kind) => kind === "order" || kind === "criteria_incomplete" || kind === "missing_sections",
  );
  return { criteriaFirst, evidence: entry.evidence.length };
};

const tally = (rows: readonly ReviewRow[], decision: DecisionEntry["decision"]): FollowedTally => {
  const chosen = rows.filter((row) => row.decision === decision);
  return { decisions: chosen.length, reverted: chosen.filter((row) => row.outcome.reverted.length > 0).length };
};

export const guardianReview = (
  runtime: Pick<Runtime, "readText" | "listDir" | "exec" | "homeDir">,
  paths: FmPaths,
): GuardianReview => {
  const entries = readDecisions(runtime, paths);
  const since = entries.map((entry) => entry.at).sort()[0];
  const commits = since === undefined ? [] : commitsSince(runtime, paths.root, since);
  const rows = entries.map((entry): ReviewRow => ({
    id: entry.id,
    source: entry.source,
    subject: entry.subject,
    at: entry.at,
    decision: entry.decision,
    ...(entry.overrideReason === undefined ? {} : { overrideReason: entry.overrideReason }),
    process: processOf(runtime, paths, entry),
    outcome: outcomeOf(runtime, paths, commits, entry),
  }));
  return {
    schema: GUARDIAN_REVIEW_SCHEMA,
    rows,
    followed: tally(rows, "followed"),
    overridden: tally(rows, "overridden"),
  };
};
