import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export const GITHUB_CACHE = ".finitemonkey/cache/github.json";
export const RULESET_PROPOSAL = ".finitemonkey/github-ruleset.json";
export const REQUIRED_CHECK = "finitemonkey ci gate";
const GH_TIMEOUT_MS = 15_000;

export interface GithubState {
  readonly repo: string;
  readonly defaultBranch: string;
  readonly rules: readonly string[];
  readonly classicProtection: boolean;
  readonly mergeQueue: boolean;
}

const gh = (runtime: Runtime, root: AbsolutePath, args: readonly string[]) =>
  runtime.exec({ command: "gh", args, cwd: root, timeoutMs: GH_TIMEOUT_MS });

const json = (text: string): unknown => {
  const parsed = parseJson(text);
  return parsed.ok ? parsed.value : undefined;
};

const repoInfo = (runtime: Runtime, root: AbsolutePath): { repo: string; branch: string } | undefined => {
  const view = gh(runtime, root, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  const value = view.exitCode === 0 ? json(view.stdout) : undefined;
  if (!isRecord(value) || typeof value["nameWithOwner"] !== "string") return undefined;
  const ref = value["defaultBranchRef"];
  const branch = isRecord(ref) && typeof ref["name"] === "string" ? ref["name"] : "main";
  return { repo: value["nameWithOwner"], branch };
};

export const readGithub = (runtime: Runtime, root: AbsolutePath): GithubState | undefined => {
  const info = repoInfo(runtime, root);
  if (info === undefined) return undefined;
  const rules = gh(runtime, root, ["api", `repos/${info.repo}/rules/branches/${info.branch}`]);
  const list = rules.exitCode === 0 ? json(rules.stdout) : [];
  const types = Array.isArray(list)
    ? list.flatMap((rule: unknown) => (isRecord(rule) && typeof rule["type"] === "string" ? [rule["type"]] : []))
    : [];
  const classic = gh(runtime, root, ["api", `repos/${info.repo}/branches/${info.branch}/protection`]);
  return {
    repo: info.repo,
    defaultBranch: info.branch,
    rules: types,
    classicProtection: classic.exitCode === 0,
    mergeQueue: types.includes("merge_queue"),
  };
};

export const isProtectedOnGithub = (state: GithubState): boolean => state.rules.length > 0 || state.classicProtection;

export const proposedRuleset = (): Readonly<Record<string, unknown>> => ({
  name: "finitemonkey: default branch",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        require_code_owner_review: true,
        dismiss_stale_reviews_on_push: true,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: REQUIRED_CHECK }],
      },
    },
    {
      type: "merge_queue",
      parameters: {
        check_response_timeout_minutes: 60,
        grouping_strategy: "ALLGREEN",
        max_entries_to_build: 5,
        max_entries_to_merge: 5,
        merge_method: "SQUASH",
        min_entries_to_merge: 1,
        min_entries_to_merge_wait_minutes: 5,
      },
    },
  ],
});

export const applyCommand = (repo: string): string =>
  `gh api --method POST repos/${repo}/rulesets --input ${RULESET_PROPOSAL}`;

export const writeProposal = (runtime: Runtime, root: AbsolutePath): boolean =>
  runtime.writeText(toAbsolutePath(join(root, RULESET_PROPOSAL)), `${JSON.stringify(proposedRuleset(), null, 2)}\n`).ok;

export const applyProposal = (runtime: Runtime, root: AbsolutePath, repo: string): boolean =>
  gh(runtime, root, ["api", "--method", "POST", `repos/${repo}/rulesets`, "--input", RULESET_PROPOSAL]).exitCode === 0;

export const writeCache = (runtime: Runtime, root: AbsolutePath, state: GithubState): void => {
  runtime.writeText(
    toAbsolutePath(join(root, GITHUB_CACHE)),
    `${JSON.stringify({ ...state, at: runtime.now() }, null, 2)}\n`,
  );
};

export const readCache = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): GithubState | undefined => {
  const text = runtime.readText(toAbsolutePath(join(root, GITHUB_CACHE)));
  const value = text.ok ? json(text.value) : undefined;
  if (!isRecord(value) || typeof value["repo"] !== "string" || typeof value["defaultBranch"] !== "string")
    return undefined;
  const rules = Array.isArray(value["rules"])
    ? value["rules"].filter((rule): rule is string => typeof rule === "string")
    : [];
  return {
    repo: value["repo"],
    defaultBranch: value["defaultBranch"],
    rules,
    classicProtection: value["classicProtection"] === true,
    mergeQueue: value["mergeQueue"] === true,
  };
};
