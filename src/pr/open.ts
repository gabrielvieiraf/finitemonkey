import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseMergeTreeConflicts } from "../gate/pr-parse.js";
import { readJournal } from "../git/journal.js";
import { openRepo, type Repo, repoFacts } from "../git/repo.js";
import { scopeFromContract } from "../merge/scope.js";
import { type Acceptance, prBody } from "./checklist.js";
import { latestMergeReport, mergeSummary, reviewersOf } from "./merge-report.js";
import { attachProvenance } from "./provenance-attach.js";
import { type ChangedFile, changedSince, checkScope } from "./scope.js";
import { restack, stackPlan } from "./stack.js";

const NETWORK_TIMEOUT_MS = 60_000;

export interface PrOpenRequest {
  readonly base: string | undefined;
  readonly title: string | undefined;
  readonly body: string;
  readonly contract: string | undefined;
  readonly acceptOutside: string | undefined;
  readonly acceptedBy: string;
  readonly draft: boolean;
  readonly dryRun: boolean;
}

export type PrOpenFailure =
  | { readonly kind: "not-repo" }
  | { readonly kind: "no-branch" }
  | { readonly kind: "protected"; readonly branch: string }
  | { readonly kind: "parent-open"; readonly parent: string }
  | { readonly kind: "restack"; readonly detail: string }
  | { readonly kind: "conflict"; readonly base: string; readonly files: readonly string[] }
  | { readonly kind: "outside"; readonly files: readonly ChangedFile[] }
  | { readonly kind: "push"; readonly detail: string }
  | { readonly kind: "gh"; readonly detail: string };

export interface PrOpened {
  readonly branch: string;
  readonly base: string;
  readonly baseSha: string;
  readonly body: string;
  readonly url: string | undefined;
  readonly outside: readonly ChangedFile[];
  readonly fetched: boolean;
  readonly reviewers: readonly string[];
}

const line = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const resolveBase = (
  runtime: Runtime,
  repo: Repo,
  request: PrOpenRequest,
  defaultBranch: string,
): Parsed<{ readonly base: string; readonly restacked: boolean }, PrOpenFailure> => {
  const plan = stackPlan(runtime, repo.root, defaultBranch);
  if (plan.kind === "parent-open") {
    return request.base === undefined || request.base === plan.parent
      ? accept({ base: plan.parent, restacked: false })
      : reject({ kind: "parent-open", parent: plan.parent });
  }
  const restacking = plan.kind === "restack" && !request.dryRun;
  if (restacking) {
    const done = restack(runtime, repo, plan.parent, defaultBranch);
    if (!done.ok) return reject({ kind: "restack", detail: done.error });
  }
  return accept({ base: request.base ?? defaultBranch, restacked: restacking });
};

const fetchBase = (runtime: Runtime, root: AbsolutePath, base: string, dryRun: boolean): boolean =>
  !dryRun && runtime.gitWith(["fetch", "--quiet", "origin", base], root, { timeoutMs: NETWORK_TIMEOUT_MS }).ok;

const baseRefOf = (runtime: Runtime, root: AbsolutePath, base: string): string =>
  line(runtime, root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`]) === undefined
    ? base
    : `origin/${base}`;

const predicted = (runtime: Runtime, root: AbsolutePath, baseRef: string): readonly string[] => {
  const result = runtime.gitWith(
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", baseRef, "HEAD"],
    root,
    {},
  );
  return result.ok ? [] : parseMergeTreeConflicts(result.stdout);
};

const snapshotsFor = (runtime: Runtime, root: AbsolutePath, branch: string): readonly string[] =>
  readJournal(runtime, root)
    .filter((entry) => entry.branch === branch)
    .slice(-5)
    .map((entry) => entry.ref);

const recordAcceptance = (
  runtime: Runtime,
  root: AbsolutePath,
  branch: string,
  acceptance: Acceptance,
  files: readonly ChangedFile[],
): void => {
  const path = toAbsolutePath(join(root, ".finitemonkey", "pr", `${branch.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`));
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey", "pr")));
  const record = {
    schema: "finitemonkey/pr-scope@1",
    branch,
    acceptedOutside: files.map((file) => file.path),
    ...acceptance,
  };
  runtime.writeText(path, `${JSON.stringify(record, null, 2)}\n`);
};

export interface Prepared {
  readonly repo: Repo;
  readonly branch: string;
  readonly base: string;
  readonly baseSha: string;
  readonly body: string;
  readonly outside: readonly ChangedFile[];
  readonly fetched: boolean;
  readonly reviewers: readonly string[];
  readonly restacked: boolean;
}

const acceptanceOf = (
  runtime: Runtime,
  request: PrOpenRequest,
  outside: readonly ChangedFile[],
): Acceptance | undefined =>
  outside.length > 0 && request.acceptOutside !== undefined
    ? { by: request.acceptedBy, at: runtime.now(), reason: request.acceptOutside }
    : undefined;

const appendOf = (runtime: Runtime, root: AbsolutePath, contract: string | undefined): readonly string[] =>
  contract === undefined ? [] : (scopeFromContract(runtime, toAbsolutePath(contract, root))?.append ?? []);

export const preparePr = (
  runtime: Runtime,
  cwd: AbsolutePath,
  request: PrOpenRequest,
): Parsed<Prepared, PrOpenFailure> => {
  const repo = openRepo(runtime, cwd);
  if (repo === undefined) return reject({ kind: "not-repo" });
  const facts = repoFacts(runtime, repo);
  const branch = facts.currentBranch();
  if (branch === undefined) return reject({ kind: "no-branch" });
  if (facts.isProtected(branch)) return reject({ kind: "protected", branch });
  const resolved = resolveBase(runtime, repo, request, facts.defaultBranch());
  if (!resolved.ok) return resolved;
  const { base, restacked } = resolved.value;
  const fetched = fetchBase(runtime, repo.root, base, request.dryRun);
  const baseRef = baseRefOf(runtime, repo.root, base);
  const conflicts = predicted(runtime, repo.root, baseRef);
  if (conflicts.length > 0) return reject({ kind: "conflict", base: baseRef, files: conflicts });
  const baseSha = line(runtime, repo.root, ["merge-base", baseRef, "HEAD"]) ?? baseRef;
  const files = changedSince(runtime, repo.root, baseSha);
  const scope = checkScope(runtime, repo.root, files, request.contract);
  if (scope.outside.length > 0 && request.acceptOutside === undefined)
    return reject({ kind: "outside", files: scope.outside });
  const accepted = acceptanceOf(runtime, request, scope.outside);
  if (accepted !== undefined && !request.dryRun) recordAcceptance(runtime, repo.root, branch, accepted, scope.outside);
  const append = appendOf(runtime, repo.root, scope.contract);
  const report = latestMergeReport(runtime, repo.root, branch);
  const plain = prBody(runtime, repo.root, {
    userBody: request.body,
    base: base,
    baseSha,
    files,
    scope,
    append,
    accepted,
    snapshots: snapshotsFor(runtime, repo.root, branch),
    mergeSummary: mergeSummary(runtime, report),
  });
  const body = attachProvenance(
    runtime,
    repo.root,
    plain,
    files.map((file) => file.path),
  );
  return accept({
    ...{ repo, branch, base: base, baseSha, body, outside: scope.outside, fetched },
    reviewers: reviewersOf(report),
    restacked,
  });
};

export const openPr = (
  runtime: Runtime,
  cwd: AbsolutePath,
  request: PrOpenRequest,
): Parsed<PrOpened, PrOpenFailure> => {
  const prepared = preparePr(runtime, cwd, request);
  if (!prepared.ok) return prepared;
  const { repo, branch, base, body } = prepared.value;
  const result = {
    branch,
    base,
    baseSha: prepared.value.baseSha,
    body,
    outside: prepared.value.outside,
    fetched: prepared.value.fetched,
    reviewers: prepared.value.reviewers,
  };
  if (request.dryRun) return accept({ ...result, url: undefined });
  const lease = prepared.value.restacked ? ["--force-with-lease"] : [];
  const pushed = runtime.gitWith(["push", "--quiet", ...lease, "-u", "origin", branch], repo.root, {
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  if (!pushed.ok) return reject({ kind: "push", detail: pushed.stderr.trim() });
  const bodyFile = toAbsolutePath(join(repo.gitDir, "finitemonkey-pr-body.md"));
  runtime.writeText(bodyFile, body);
  const title = request.title ?? line(runtime, repo.root, ["log", "-1", "--format=%s"]) ?? branch;
  const args = [
    "pr",
    "create",
    "--base",
    base,
    "--head",
    branch,
    "--title",
    title,
    "--body-file",
    bodyFile,
    ...(request.draft ? ["--draft"] : []),
    ...prepared.value.reviewers.flatMap((reviewer) => ["--reviewer", reviewer]),
  ];
  const created = runtime.exec({ command: "gh", args, cwd: repo.root, timeoutMs: NETWORK_TIMEOUT_MS });
  runtime.remove(bodyFile);
  if (!created.found) return reject({ kind: "gh", detail: "gh is not installed" });
  if (created.exitCode !== 0) return reject({ kind: "gh", detail: created.stderr.trim() });
  return accept({ ...result, url: created.stdout.trim().split("\n").pop() });
};
