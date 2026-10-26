import type { AbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { currentBranch, type Git, headSha } from "./git.js";
import { parseMergeTreeConflicts, parsePrView, type PrInfo } from "./pr-parse.js";

export type PrStatus =
  | { readonly kind: "no_gh" }
  | { readonly kind: "network"; readonly detail: string }
  | { readonly kind: "no_branch" }
  | { readonly kind: "none"; readonly branch: string }
  | { readonly kind: "found"; readonly branch: string; readonly pr: PrInfo; readonly localHead: string | undefined };

type Fetched =
  PrStatus | { readonly kind: "fetched"; readonly branch: string; readonly pr: PrInfo; readonly view: string };

export const PR_FIELDS = "number,url,state,mergeable,mergeStateStatus,baseRefName,headRefOid,statusCheckRollup";
export const PR_CACHE_TTL_MS = 60_000;
export const GH_TIMEOUT_MS = 8000;

const gh = (runtime: Pick<Runtime, "exec">, cwd: AbsolutePath, args: readonly string[], timeoutMs = GH_TIMEOUT_MS) =>
  runtime.exec({ command: "gh", args, cwd, timeoutMs });

export const ghAuthenticated = (
  runtime: Pick<Runtime, "exec">,
  cwd: AbsolutePath,
  timeoutMs = 4000,
): "yes" | "no" | "timeout" => {
  const result = gh(runtime, cwd, ["auth", "status"], timeoutMs);
  if (result.timedOut) return "timeout";
  return result.found && result.exitCode === 0 ? "yes" : "no";
};

const cached = (
  runtime: Pick<Runtime, "readText" | "now">,
  paths: FmPaths,
  branch: string,
  ttlMs: number,
): PrInfo | undefined => {
  const raw = readJsonFile(runtime, paths.cache("pr.json"));
  const at = raw?.["fetchedAt"];
  if (raw?.["branch"] !== branch || typeof at !== "number" || nowMs(runtime) - at > ttlMs) return undefined;
  const view = raw["view"];
  return typeof view === "string" ? parsePrView(view) : undefined;
};

const fetchView = (runtime: Runtime, git: Git, branch: string): Fetched => {
  const auth = ghAuthenticated(runtime, git.cwd);
  if (auth === "timeout") return { kind: "network", detail: "gh auth status timed out" };
  if (auth === "no") return { kind: "no_gh" };
  const view = gh(runtime, git.cwd, ["pr", "view", branch, "--json", PR_FIELDS]);
  if (view.timedOut) return { kind: "network", detail: "gh pr view timed out" };
  if (view.exitCode !== 0) {
    if (/no (open )?pull requests? found|no git remotes/i.test(view.stderr)) return { kind: "none", branch };
    return { kind: "network", detail: view.stderr.trim().split("\n")[0] ?? "gh failed" };
  }
  const pr = parsePrView(view.stdout);
  return pr === undefined
    ? { kind: "network", detail: "gh returned unexpected JSON" }
    : { kind: "fetched", branch, pr, view: view.stdout };
};

export const prStatus = (runtime: Runtime, git: Git, paths: FmPaths, ttlMs = PR_CACHE_TTL_MS): PrStatus => {
  const branch = currentBranch(git);
  if (branch === undefined) return { kind: "no_branch" };
  const hit = cached(runtime, paths, branch, ttlMs);
  if (hit !== undefined) return { kind: "found", branch, pr: hit, localHead: headSha(git) };
  const status = fetchView(runtime, git, branch);
  if (status.kind !== "fetched") return status;
  writeJsonFile(runtime, paths.cache("pr.json"), { fetchedAt: nowMs(runtime), branch, view: status.view });
  return { kind: "found", branch, pr: status.pr, localHead: headSha(git) };
};

export const conflictFiles = (git: Git, base: string): readonly string[] => {
  for (const target of [`origin/${base}`, base]) {
    if (git.out(["rev-parse", "--verify", "-q", `${target}^{commit}`]) === undefined) continue;
    const result = git.run(["merge-tree", "--write-tree", "--name-only", "--no-messages", target, "HEAD"]);
    if (result.found && result.exitCode === 1) return parseMergeTreeConflicts(result.stdout);
    if (result.found && result.exitCode === 0) return [];
  }
  return [];
};
