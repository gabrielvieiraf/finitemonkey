import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type GitFacts, memo, memoBy, parsePorcelainV2, type Upstream } from "./facts.js";
import { configList, type ConfigTree, loadProjectConfig } from "./project-config.js";

export interface Repo {
  readonly root: AbsolutePath;
  readonly gitDir: AbsolutePath;
  readonly prefix: string;
}

export const DEFAULT_PROTECTED = ["main", "master", "release/*", "prod", "production", "rc-*"] as const;

export const openRepo = (runtime: Runtime, dir: AbsolutePath): Repo | undefined => {
  const result = runtime.git(["rev-parse", "--show-toplevel", "--absolute-git-dir", "--show-prefix"], dir);
  if (!result.ok) return undefined;
  const [root, gitDir, prefix] = result.stdout.split("\n");
  if (root === undefined || root === "" || gitDir === undefined || gitDir === "") return undefined;
  return {
    root: toAbsolutePath(root),
    gitDir: toAbsolutePath(gitDir),
    prefix: (prefix ?? "").replace(/\/$/, ""),
  };
};

const globRegex = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

export const matchesBranch = (branch: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => globRegex(pattern).test(branch));

const line = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const refExists = (runtime: Runtime, root: AbsolutePath, ref: string): boolean =>
  runtime.git(["show-ref", "--verify", "--quiet", ref], root).ok;

const defaultBranchOf = (runtime: Runtime, root: AbsolutePath): string => {
  const remote = line(runtime, root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remote !== undefined) return remote.replace(/^[^/]+\//, "");
  const configured = line(runtime, root, ["config", "--get", "init.defaultBranch"]);
  if (configured !== undefined && refExists(runtime, root, `refs/heads/${configured}`)) return configured;
  return refExists(runtime, root, "refs/heads/master") && !refExists(runtime, root, "refs/heads/main")
    ? "master"
    : "main";
};

const upstreamOf = (runtime: Runtime, root: AbsolutePath, branch: string): Upstream | undefined => {
  const remote = line(runtime, root, ["config", "--get", `branch.${branch}.remote`]);
  const merge = line(runtime, root, ["config", "--get", `branch.${branch}.merge`]);
  if (remote === undefined || merge === undefined || remote === ".") return undefined;
  const name = merge.replace(/^refs\/heads\//, "");
  return { branch: name, remoteRef: `refs/remotes/${remote}/${name}` };
};

const integrationRefs = (runtime: Runtime, root: AbsolutePath, defaultBranch: string): readonly string[] =>
  [`refs/heads/${defaultBranch}`, `refs/remotes/origin/${defaultBranch}`].filter((ref) =>
    refExists(runtime, root, ref),
  );

const contained = (runtime: Runtime, root: AbsolutePath, branch: string, targets: readonly string[]): boolean => {
  const tip = line(runtime, root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (tip === undefined) return true;
  return targets
    .filter((target) => target !== `refs/heads/${branch}`)
    .some((target) => runtime.git(["merge-base", "--is-ancestor", tip, target], root).ok);
};

const shared = (
  runtime: Runtime,
  root: AbsolutePath,
  upstream: Upstream | undefined,
  base: readonly string[],
): boolean => {
  if (upstream === undefined || !refExists(runtime, root, upstream.remoteRef)) return false;
  const own = line(runtime, root, ["config", "--get", "user.email"]) ?? "";
  const log = runtime.git(["log", "--format=%ae", upstream.remoteRef, ...base.map((ref) => `^${ref}`)], root);
  return log.ok && log.stdout.split("\n").some((email) => email.trim() !== "" && email.trim() !== own);
};

export const protectedPatterns = (config: ConfigTree, defaultBranch: string): readonly string[] => [
  defaultBranch,
  ...DEFAULT_PROTECTED,
  ...configList(config, "git", "protected"),
];

export const repoFacts = (
  runtime: Runtime,
  repo: Repo,
  config: ConfigTree = loadProjectConfig(runtime, repo.root),
): GitFacts => {
  const { root } = repo;
  const defaultBranch = memo(() => defaultBranchOf(runtime, root));
  const patterns = memo(() => protectedPatterns(config, defaultBranch()));
  const upstream = memoBy((branch) => upstreamOf(runtime, root, branch));
  const integration = memo(() => integrationRefs(runtime, root, defaultBranch()));
  return {
    prefix: repo.prefix,
    currentBranch: memo(() => line(runtime, root, ["symbolic-ref", "--quiet", "--short", "HEAD"])),
    defaultBranch,
    isProtected: (branch) => matchesBranch(branch, patterns()),
    dirty: memo(() => {
      const status = runtime.git(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root);
      return status.ok ? parsePorcelainV2(status.stdout) : undefined;
    }),
    isRef: memoBy((name) => runtime.git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`], root).ok),
    branchExists: memoBy((name) => refExists(runtime, root, `refs/heads/${name}`)),
    branchContained: memoBy((branch) => {
      const up = upstream(branch);
      return contained(runtime, root, branch, [...(up === undefined ? [] : [up.remoteRef]), ...integration()]);
    }),
    upstream,
    sharedBranch: memoBy((branch) => shared(runtime, root, upstream(branch), integration())),
  };
};
