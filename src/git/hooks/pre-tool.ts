import { basename, dirname } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { PROD_PROGRAMS, type ProdDecision, prodGuard, recordEvidence } from "../../prod/guard.js";
import { toolName } from "../../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../../shell/normalize.js";
import type { ShellCommand } from "../../shell/types.js";
import { commandText } from "../command-text.js";
import { destructiveHit, externalBlockers, pipeToShell } from "../destructive.js";
import { memo } from "../facts.js";
import { guardGitCommand, type GuardOutcome } from "../guard.js";
import { isWithin, pathKey, resolveFrom } from "../path-key.js";
import { openRepo, type Repo } from "../repo.js";
import { listWorktrees, removalTargets, rmVerdict } from "../rm-guard.js";
import { takeSnapshot } from "../snapshot.js";
import type { GitBlockRule } from "../verdict.js";
import { ownerOf, shellText } from "./context.js";
import { outcomeMessage, ruleMessage } from "./messages.js";

const ALLOW: HookDecision = { kind: "allow" };

type SnapshotOutcome = Extract<GuardOutcome, { readonly kind: "snapshot" }>;

const BROAD_RULES: ReadonlySet<GitBlockRule> = new Set([
  "rm-root",
  "force-push",
  "push-delete",
  "push-mirror",
  "clean",
  "stash-drop",
  "branch-unmerged",
  "worktree-force",
  "sql-destroy",
  "terraform-destroy",
  "kubectl-delete",
  "pipe-shell",
]);

interface Scan {
  readonly worktrees: () => readonly string[];
  readonly repo: () => Repo | undefined;
  readonly repoAt: (dir: string) => Repo | undefined;
  readonly blockers: () => readonly string[];
}

const leftToBlocker = (scan: Scan, rule: GitBlockRule): boolean => BROAD_RULES.has(rule) && scan.blockers().length > 0;

const mayExist = (input: HookInput, target: string, path: string): boolean => {
  if (/^[$~%]|[*?[]/.test(target) || input.runtime.stat(toAbsolutePath(path)) !== undefined) return true;
  const siblings = input.runtime.listDir(toAbsolutePath(dirname(path)));
  return siblings.ok && siblings.value.includes(basename(path));
};

const inRepo = (input: HookInput, scan: Scan, command: ShellCommand): Repo | undefined => {
  const present = (removalTargets(command) ?? [])
    .map((target) => ({ target, path: resolveFrom(input.cwd, command.dir, target) }))
    .filter(({ target, path }) => mayExist(input, target, path));
  if (present.length === 0) return undefined;
  const repo = scan.repo();
  return repo !== undefined &&
    present.some(({ path }) => isWithin(path, repo.root) || isWithin(input.runtime.realpath(path), repo.root))
    ? repo
    : undefined;
};

const rmOutcome = (input: HookInput, command: ShellCommand, scan: Scan): string | SnapshotOutcome | undefined => {
  if (removalTargets(command) === undefined) return undefined;
  const context = { cwd: input.cwd, home: input.runtime.homeDir(), worktrees: scan.worktrees };
  const verdict = rmVerdict(input.runtime, context, command);
  if (verdict.kind === "block" && !leftToBlocker(scan, verdict.rule)) {
    return ruleMessage(input.t, verdict.rule, commandText(command), verdict.subject);
  }
  const repo = inRepo(input, scan, command);
  const text = commandText(command);
  return repo === undefined ? undefined : { kind: "snapshot", repo, op: `rm ${text}`.slice(0, 80), command: text };
};

const destructiveOutcome = (input: HookInput, command: ShellCommand, scan: Scan): string | undefined => {
  const hit = destructiveHit(command, { runtime: input.runtime, home: input.runtime.homeDir(), env: input.env });
  if (hit === undefined || leftToBlocker(scan, hit.rule)) return undefined;
  return ruleMessage(input.t, hit.rule, commandText(command), hit.subject);
};

const snapshotsOf = (input: HookInput, owner: string, pending: readonly SnapshotOutcome[]): HookDecision => {
  const done = new Map<string, string>();
  for (const item of pending) {
    if (done.has(item.repo.root)) continue;
    const taken = takeSnapshot(input.runtime, item.repo, { op: item.op, owner, command: item.command });
    if (!taken.ok) {
      return {
        kind: "block",
        reason: modelReason(input.t, "git.block.snapshot_failed", { command: item.command, detail: taken.error }),
        human: input.t("git.block.human"),
      };
    }
    done.set(item.repo.root, input.t("git.snapshot.context", { command: item.command, ref: taken.value.ref }));
  }
  if (done.size === 0) return ALLOW;
  const context = [...done.values()].join("\n");
  return { kind: "allow", output: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context } } };
};

interface Review {
  readonly blocked: string | undefined;
  readonly human?: "git.block.human" | "prod.block.human";
  readonly snapshots: readonly SnapshotOutcome[];
  readonly reads: readonly ProdDecision[];
}

const handedOver = (scan: Scan, outcome: GuardOutcome): GuardOutcome => {
  if (outcome.kind !== "block" || !leftToBlocker(scan, outcome.rule)) return outcome;
  const repo = scan.repo();
  return repo === undefined ? { kind: "pass" } : { kind: "snapshot", repo, op: outcome.rule, command: outcome.command };
};

const scanOf = (input: HookInput): Scan => {
  const repo = memo((): Repo | undefined => openRepo(input.runtime, input.cwd));
  const cwd = pathKey(input.cwd);
  return {
    worktrees: memo(() => listWorktrees(input.runtime, input.cwd)),
    repo,
    repoAt: (dir) => (pathKey(dir) === cwd ? repo() : undefined) ?? openRepo(input.runtime, toAbsolutePath(dir)),
    blockers: memo(() => externalBlockers(input.runtime, repo()?.root ?? input.cwd, input.runtime.homeDir())),
  };
};

const review = (input: HookInput, commands: readonly ShellCommand[], owner: string, scan: Scan): Review => {
  const { repo } = scan;
  const prod = memo(() => prodGuard(input.runtime, repo()?.root ?? input.cwd, input.t));
  const snapshots: SnapshotOutcome[] = [];
  const reads: ProdDecision[] = [];
  const chain = { branch: undefined };
  for (const command of commands) {
    const removal = rmOutcome(input, command, scan);
    if (typeof removal === "string") return { blocked: removal, human: "git.block.human", snapshots, reads };
    if (removal !== undefined) snapshots.push(removal);
    const decision = PROD_PROGRAMS.has(command.program) ? prod().decide(command) : undefined;
    if (decision?.kind === "block") return { blocked: decision.reason, human: "prod.block.human", snapshots, reads };
    if (decision !== undefined) reads.push(decision);
    const destructive = destructiveOutcome(input, command, scan);
    if (destructive !== undefined) return { blocked: destructive, human: "git.block.human", snapshots, reads };
    for (const found of guardGitCommand(
      { runtime: input.runtime, cwd: input.cwd, owner, chain, repoAt: scan.repoAt },
      command,
    )) {
      const outcome = handedOver(scan, found);
      const message = outcomeMessage(input.t, outcome);
      if (message !== undefined) return { blocked: message, human: "git.block.human", snapshots, reads };
      if (outcome.kind === "snapshot") snapshots.push(outcome);
    }
  }
  return { blocked: undefined, snapshots, reads };
};

export const gitPreToolUse: HookHandler = (input) => {
  const text = shellText(input.payload);
  if (text === undefined) return ALLOW;
  const commands = normalizeCommand(text, dialectOf(toolName(input.payload))).commands;
  if (commands.length === 0) return ALLOW;
  const owner = ownerOf(input.payload);
  const scan = scanOf(input);
  const piped = pipeToShell(text, dialectOf(toolName(input.payload)));
  if (piped !== undefined && !leftToBlocker(scan, "pipe-shell")) {
    const reason = ruleMessage(input.t, "pipe-shell", text.slice(0, 200), piped);
    return { kind: "block", reason, human: input.t("git.block.human") };
  }
  const result = review(input, commands, owner, scan);
  if (result.blocked !== undefined) {
    return { kind: "block", reason: result.blocked, human: input.t(result.human ?? "git.block.human") };
  }
  if (result.reads.length > 0) {
    recordEvidence(
      input.runtime,
      openRepo(input.runtime, input.cwd)?.root ?? toAbsolutePath(input.cwd),
      owner,
      result.reads,
    );
  }
  return snapshotsOf(input, owner, result.snapshots);
};
