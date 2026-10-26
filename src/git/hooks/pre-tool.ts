import { toAbsolutePath } from "../../core/brand.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { PROD_PROGRAMS, type ProdDecision, prodGuard, recordEvidence } from "../../prod/guard.js";
import { toolName } from "../../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../../shell/normalize.js";
import type { ShellCommand } from "../../shell/types.js";
import { commandText } from "../command-text.js";
import { memo } from "../facts.js";
import { guardGitCommand, type GuardOutcome } from "../guard.js";
import { openRepo, type Repo } from "../repo.js";
import { listWorktrees, removalTargets, rmVerdict } from "../rm-guard.js";
import { takeSnapshot } from "../snapshot.js";
import { ownerOf, shellText } from "./context.js";
import { outcomeMessage, ruleMessage } from "./messages.js";

const ALLOW: HookDecision = { kind: "allow" };

type SnapshotOutcome = Extract<GuardOutcome, { readonly kind: "snapshot" }>;

const rmOutcome = (input: HookInput, command: ShellCommand, worktrees: () => readonly string[]): string | undefined => {
  if (removalTargets(command) === undefined) return undefined;
  const verdict = rmVerdict(input.runtime, { cwd: input.cwd, home: input.runtime.homeDir(), worktrees }, command);
  return verdict.kind === "block"
    ? ruleMessage(input.t, verdict.rule, commandText(command), verdict.subject)
    : undefined;
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

const review = (input: HookInput, commands: readonly ShellCommand[], owner: string): Review => {
  const worktrees = memo(() => listWorktrees(input.runtime, input.cwd));
  const repo = memo((): Repo | undefined => openRepo(input.runtime, input.cwd));
  const prod = memo(() => prodGuard(input.runtime, repo()?.root ?? input.cwd, input.t));
  const snapshots: SnapshotOutcome[] = [];
  const reads: ProdDecision[] = [];
  const chain = { branch: undefined };
  for (const command of commands) {
    const removal = rmOutcome(input, command, worktrees);
    if (removal !== undefined) return { blocked: removal, human: "git.block.human", snapshots, reads };
    const decision = PROD_PROGRAMS.has(command.program) ? prod().decide(command) : undefined;
    if (decision?.kind === "block") return { blocked: decision.reason, human: "prod.block.human", snapshots, reads };
    if (decision !== undefined) reads.push(decision);
    for (const outcome of guardGitCommand({ runtime: input.runtime, cwd: input.cwd, owner, chain }, command)) {
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
  const result = review(input, commands, owner);
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
