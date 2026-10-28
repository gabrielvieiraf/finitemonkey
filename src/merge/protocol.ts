import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { accept, type Parsed } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configMap, loadProjectConfig } from "../git/project-config.js";
import { levelRules } from "../profile/level.js";
import type { WorktreeOwner } from "../wt/entry.js";
import { commonDirOf } from "../wt/store.js";
import { applyResolutions, regenerate } from "./apply.js";
import { commitMerge, type DroppedEntry, finishChecks } from "./finish.js";
import { type Integration, openIntegration, resolveSides, type Sides, snapshotTips, stampOf } from "./integrate.js";
import {
  type FileReport,
  MERGE_REPORT_SCHEMA,
  type MergeReport,
  type MergeStop,
  reportPathFor,
  writeReport,
} from "./report.js";
import { decisionOf, type FileResolution, resolveFile } from "./resolve-file.js";
import { loadScope, type Scopes, type SideScope } from "./scope.js";
import { sameSymbolBothSides } from "./semantic.js";
import { conflictedStageIds, fileInputs } from "./stages.js";
import { commitsTouching, traceHunks } from "./trace.js";

export interface MergeRequest {
  readonly source: string;
  readonly target: string | undefined;
  readonly checks: readonly string[];
  readonly targetContract: string | undefined;
  readonly sourceContract: string | undefined;
  readonly declaredRemovals: readonly string[];
  readonly owner: WorktreeOwner;
  readonly sourceScope?: SideScope;
  readonly targetScope?: SideScope;
}

interface Run {
  readonly runtime: Runtime;
  readonly cwd: AbsolutePath;
  readonly sides: Sides;
  readonly integration: Integration;
  readonly scopes: Scopes;
}

const diffNames = (runtime: Runtime, cwd: AbsolutePath, from: string, to: string): readonly string[] => {
  const result = runtime.git(["diff", "--name-only", from, to], cwd);
  return result.ok ? result.stdout.split("\n").filter((line) => line !== "") : [];
};

const resolveAll = (run: Run, request: MergeRequest): readonly FileResolution[] => {
  const { runtime, integration } = run;
  const generators = configMap(loadProjectConfig(runtime, run.cwd), "merge", "generators");
  const gitDir = toAbsolutePath(runtime.git(["rev-parse", "--absolute-git-dir"], integration.path).stdout.trim());
  const hints = configMap(loadProjectConfig(runtime, run.cwd), "merge", "policies");
  const context = { scopes: run.scopes, declaredRemovals: new Set(request.declaredRemovals), hints };
  return [...conflictedStageIds(runtime, integration.path)].map(([path, ids]) =>
    resolveFile(fileInputs(runtime, integration.path, gitDir, path, ids, generators), context),
  );
};

const fileReport = (run: Run, file: FileResolution, proposal: boolean): FileReport => {
  const { runtime, sides, integration } = run;
  const base = sides.bases[0] ?? sides.targetSha;
  const commits = {
    oursCommits: commitsTouching(runtime, integration.path, base, sides.targetSha, file.path),
    theirsCommits: commitsTouching(runtime, integration.path, base, sides.sourceSha, file.path),
  };
  return {
    path: file.path,
    class: file.cls,
    rule: file.rule,
    decision: file.decision,
    proposal: proposal ? "rerere" : null,
    hint: file.hint,
    hunks: traceHunks(file.stages, file.hunks, commits, (hunk) => decisionOf(hunk.verdict)),
  };
};

const dropsOf = (files: readonly FileResolution[]): readonly DroppedEntry[] =>
  files.flatMap((file) => [
    ...(file.droppedSide === undefined ? [] : [{ file: file.path, side: file.droppedSide, reason: "decisao_humana" }]),
    ...file.sameIntent.map((item) => ({
      file: file.path,
      side: item.side,
      reason: "mesma_intencao_outro_lado",
      text: item.text,
    })),
  ]);

const reportOf = (
  run: Run,
  parts: Omit<
    MergeReport,
    | "schema"
    | "at"
    | "target"
    | "source"
    | "bases"
    | "virtualBase"
    | "integration"
    | "undo"
    | "reportPath"
    | "conclusion"
  >,
  stamp: string,
  commonDir: AbsolutePath,
): MergeReport => ({
  schema: MERGE_REPORT_SCHEMA,
  at: run.runtime.now(),
  target: { ref: run.sides.targetRef, sha: run.sides.targetSha },
  source: { ref: run.sides.sourceRef, sha: run.sides.sourceSha },
  bases: run.sides.bases,
  virtualBase: run.sides.bases.length > 1,
  integration: {
    branch: run.integration.entry.branch ?? "",
    path: run.integration.entry.path,
    id: run.integration.entry.id,
  },
  conclusion: conclusionFor(run, parts.outcome),
  undo: `finitemonkey wt archive ${run.integration.entry.id}`,
  reportPath: reportPathFor(commonDir, stamp),
  ...parts,
});

const conclusionFor = (run: Run, outcome: MergeReport["outcome"]): MergeReport["conclusion"] => {
  if (outcome !== "merged") return "none";
  return levelRules(run.runtime, run.cwd).mergeDefault === "pr-or-fast-forward"
    ? "fast-forward-allowed"
    : "pull-request";
};

const proposalPaths = (files: readonly FileResolution[]): ReadonlySet<string> =>
  new Set(files.filter((file) => file.rerereProposal).map((file) => file.path));

interface Prepared {
  readonly run: Run;
  readonly stamp: string;
  readonly snapshots: readonly string[];
  readonly commonDir: AbsolutePath;
  readonly base: string;
}

const prepare = (runtime: Runtime, cwd: AbsolutePath, env: Env, request: MergeRequest): Parsed<Prepared> => {
  const sides = resolveSides(runtime, cwd, request.source, request.target);
  if (!sides.ok) return sides;
  const commonDir = commonDirOf(runtime, cwd);
  if (commonDir === undefined) return { ok: false, error: "not a git repository" };
  const stamp = stampOf(runtime.now());
  const snapshots = snapshotTips(runtime, cwd, sides.value, stamp);
  const integration = openIntegration(runtime, cwd, env, sides.value, request.owner);
  if (!integration.ok) return integration;
  const base = sides.value.bases[0] ?? sides.value.targetSha;
  const scopes: Scopes = {
    ours:
      request.targetScope ??
      loadScope(runtime, cwd, request.targetContract, diffNames(runtime, cwd, base, sides.value.targetSha)),
    theirs:
      request.sourceScope ??
      loadScope(runtime, cwd, request.sourceContract, diffNames(runtime, cwd, base, sides.value.sourceSha)),
  };
  const run: Run = { runtime, cwd, sides: sides.value, integration: integration.value, scopes };
  return accept({ run, stamp, snapshots, commonDir, base });
};

export const runMerge = (runtime: Runtime, cwd: AbsolutePath, env: Env, request: MergeRequest): Parsed<MergeReport> => {
  const prepared = prepare(runtime, cwd, env, request);
  if (!prepared.ok) return prepared;
  const { run, base } = prepared.value;
  const dir = run.integration.path;
  const files = resolveAll(run, request);
  const stops: MergeStop[] = files.flatMap((file) => (file.stop === undefined ? [] : [file.stop]));
  stops.push(...applyResolutions(runtime, dir, files), ...regenerate(runtime, dir, files));
  const conflicted = new Set(files.map((file) => file.path));
  const semantic = sameSymbolBothSides(runtime, dir, base, run.sides.targetSha, run.sides.sourceSha, conflicted);
  const finished = stops.length === 0 ? finishChecks(runtime, dir, base, request.checks, dropsOf(files)) : undefined;
  stops.push(...(finished?.stops ?? []));
  const commit = stops.length === 0 ? (commitMerge(runtime, dir) ?? null) : null;
  if (stops.length === 0 && commit === null) stops.push({ reason: "commit-failed", path: null });
  const proposals = proposalPaths(files);
  const report = reportOf(
    run,
    {
      snapshots: prepared.value.snapshots,
      files: files.map((file) => fileReport(run, file, proposals.has(file.path))),
      dropped: dropsOf(files),
      checks: finished?.checks ?? [],
      semanticCandidates: [...semantic, ...(finished?.callers ?? [])],
      stops,
      outcome: stops.length === 0 ? "merged" : "stopped",
      commit,
    },
    prepared.value.stamp,
    prepared.value.commonDir,
  );
  writeReport(runtime, report);
  return accept(report);
};
