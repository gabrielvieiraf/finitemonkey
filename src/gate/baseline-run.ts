import { writeBaseline } from "./baseline.js";
import { runShellCheck } from "./checks/command.js";
import { gitAt, treeHash } from "./git.js";
import { type GateOptions, prepareGate } from "./prepare.js";
import type { Baseline, BaselineEntry } from "./types.js";

export type BaselineRun =
  | { readonly kind: "recorded"; readonly treeHash: string; readonly checks: Baseline }
  | { readonly kind: "skipped"; readonly reason: "not_ready" | "untrusted" | "no_commands" | "tree_moved" };

export const runBaseline = (options: GateOptions): BaselineRun => {
  const ready = prepareGate({ ...options, noSkip: true });
  if (ready.kind !== "ready") return { kind: "skipped", reason: "not_ready" };
  const ctx = { ...ready.prepared.ctx, baseline: undefined };
  if (!ctx.trusted) return { kind: "skipped", reason: "untrusted" };
  const commands = ctx.contract.acceptance.filter(
    (check) => check.run !== undefined && (check.kind === "command" || check.kind === "tests"),
  );
  if (commands.length === 0) return { kind: "skipped", reason: "no_commands" };
  const checks: Record<string, BaselineEntry> = {};
  for (const check of commands) {
    const outcome = runShellCheck(check, check.run ?? "", ctx, { pin: false });
    checks[check.id] = {
      exitCode: outcome.exitCode ?? null,
      failures: outcome.failures ?? [],
      ...(outcome.testCount === undefined ? {} : { testCount: outcome.testCount }),
    };
  }
  if (treeHash(gitAt(ctx.runtime, ctx.paths.root)) !== ctx.treeHash) return { kind: "skipped", reason: "tree_moved" };
  writeBaseline(ctx.runtime, ctx.paths, ctx.treeHash, checks);
  return { kind: "recorded", treeHash: ctx.treeHash, checks };
};
