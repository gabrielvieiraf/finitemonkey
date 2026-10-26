import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { normalizeCommand } from "../shell/normalize.js";
import type { ShellCommand } from "../shell/types.js";
import { commandText } from "./command-text.js";
import type { DirtyEntry, GitFacts } from "./facts.js";
import { type GitInvocation, gitInvocation, withAlias } from "./invocation.js";
import { type ForeignFile, foreignFiles } from "./ownership.js";
import { resolveFrom } from "./path-key.js";
import { matchPathspecs } from "./pathspec.js";
import { openRepo, type Repo, repoFacts } from "./repo.js";
import { switchTarget } from "./switch-target.js";
import { BUILTIN_SUBCOMMANDS, gitVerdict } from "./rules/index.js";
import type { DiscardSpec, GitBlockRule, GitVerdict } from "./verdict.js";

export type GuardOutcome =
  | { readonly kind: "pass" }
  | { readonly kind: "block"; readonly rule: GitBlockRule; readonly subject: string; readonly command: string }
  | { readonly kind: "foreign"; readonly files: readonly ForeignFile[]; readonly command: string }
  | { readonly kind: "unknown"; readonly command: string }
  | { readonly kind: "snapshot"; readonly repo: Repo; readonly op: string; readonly command: string };

const MAX_ALIAS_DEPTH = 3;

const expandAlias = (runtime: Runtime, repo: Repo, invocation: GitInvocation, depth = 0): GitInvocation => {
  if (depth >= MAX_ALIAS_DEPTH || BUILTIN_SUBCOMMANDS.has(invocation.subcommand) || invocation.subcommand === "")
    return invocation;
  const inline = invocation.config[`alias.${invocation.subcommand.toLowerCase()}`];
  const configured =
    inline ?? runtime.git(["config", "--get", `alias.${invocation.subcommand}`], repo.root).stdout.trim();
  if (configured === "" || configured.startsWith("!")) return invocation;
  const words = normalizeCommand(`git ${configured}`).commands[0]?.args ?? [];
  return expandAlias(runtime, repo, withAlias(invocation, words), depth + 1);
};

const targetsOf = (entries: readonly DirtyEntry[], spec: DiscardSpec, prefix: string): readonly string[] =>
  entries
    .filter((entry) => {
      if (spec.scope === "tracked") return entry.kind !== "untracked";
      if (spec.scope === "worktree") return entry.kind !== "untracked" && entry.unstaged;
      return true;
    })
    .filter((entry) => spec.pathspecs.length === 0 || matchPathspecs(entry.path, spec.pathspecs, prefix))
    .map((entry) => entry.path);

const shellAliasCommands = (invocation: GitInvocation, runtime: Runtime, repo: Repo): readonly ShellCommand[] => {
  const configured =
    invocation.config[`alias.${invocation.subcommand.toLowerCase()}`] ??
    runtime.git(["config", "--get", `alias.${invocation.subcommand}`], repo.root).stdout.trim();
  return configured.startsWith("!") ? normalizeCommand(configured.slice(1)).commands : [];
};

export interface GuardContext {
  readonly runtime: Runtime;
  readonly cwd: string;
  readonly owner: string;
  readonly facts?: (repo: Repo) => GitFacts;
  readonly chain?: ChainState;
}

export interface ChainState {
  branch: string | undefined;
}

const withChain = (facts: GitFacts, chain: ChainState | undefined): GitFacts => {
  const branch = chain?.branch;
  return branch === undefined ? facts : { ...facts, currentBranch: () => branch };
};

const decide = (
  context: GuardContext,
  repo: Repo,
  verdict: GitVerdict,
  facts: GitFacts,
  text: string,
): GuardOutcome => {
  switch (verdict.kind) {
    case "pass":
      return { kind: "pass" };
    case "block":
      return { kind: "block", rule: verdict.rule, subject: verdict.subject, command: text };
    case "snapshot":
      return { kind: "snapshot", repo, op: verdict.op, command: text };
    case "discard": {
      const entries = facts.dirty();
      if (entries === undefined) return { kind: "unknown", command: text };
      const foreign = foreignFiles(
        context.runtime,
        repo,
        context.owner,
        targetsOf(entries, verdict.discard, facts.prefix),
      );
      return foreign.length > 0
        ? { kind: "foreign", files: foreign, command: text }
        : { kind: "snapshot", repo, op: verdict.op, command: text };
    }
  }
};

export const guardGitCommand = (context: GuardContext, command: ShellCommand, depth = 0): readonly GuardOutcome[] => {
  const invocation = gitInvocation(command);
  if (invocation === undefined) return [];
  const dir = resolveFrom(context.cwd, command.dir, ...invocation.dirs);
  const repo = openRepo(context.runtime, toAbsolutePath(dir));
  if (repo === undefined) return [];
  const facts = withChain(context.facts?.(repo) ?? repoFacts(context.runtime, repo), context.chain);
  const expanded = expandAlias(context.runtime, repo, invocation);
  const target = switchTarget(expanded, facts);
  if (target !== undefined && context.chain !== undefined) context.chain.branch = target;
  const nested =
    depth < MAX_ALIAS_DEPTH
      ? shellAliasCommands(expanded, context.runtime, repo).flatMap((inner) =>
          guardGitCommand(context, inner, depth + 1),
        )
      : [];
  return [...nested, decide(context, repo, gitVerdict(expanded, facts), facts, commandText(command))];
};
