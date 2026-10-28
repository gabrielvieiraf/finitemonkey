import { dirname, join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { logEvent } from "../../evidence/log.js";
import { astCounter } from "../../guards/tests/ast-count.js";
import { isSnapshot, isTestFile, testLanguage } from "../../guards/tests/patterns.js";
import { guardMode, readWorking } from "../../quality/gate-sources.js";
import { loadTypescript } from "../../quality/ts-api.js";
import { sha256Hex } from "../../secrets/fingerprint.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { currentBranch, fileAt } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";
import { runShellCheck } from "./command.js";

export const REGRESSION_GUARD = "regression";
export const REGRESSION_DIR = ".finitemonkey/regression";
const CACHE_FILE = "regression.json";
const FIX_GOAL = /\b(?:fix|fixes|fixed|bug|bugfix|hotfix|regression)\b/i;
const FIX_BRANCH = /^(?:fix|bugfix|hotfix)[/-]/i;

export const isFixTask = (ctx: GateContext): boolean =>
  FIX_GOAL.test(ctx.contract.goal) || FIX_BRANCH.test(currentBranch(ctx.git) ?? "");

export const newTestFiles = (ctx: GateContext): readonly string[] => {
  const count = astCounter(loadTypescript(ctx.paths.root));
  return ctx.changes.flatMap((change) => {
    const language = testLanguage(change.path);
    if (change.status === "D" || language === undefined || isSnapshot(change.path)) return [];
    if (change.status === "A") return [change.path];
    const before = fileAt(ctx.git, ctx.base, change.oldPath ?? change.path) ?? "";
    const after = readWorking(ctx, change.path) ?? "";
    return count(language, after, change.path).tests > count(language, before, change.path).tests ? [change.path] : [];
  });
};

type BaseRun = { readonly kind: "ran"; readonly outcome: CheckOutcome } | { readonly kind: "no_worktree" };

const runOnBase = (ctx: GateContext, check: AcceptanceCheck, run: string, files: readonly string[]): BaseRun => {
  const dir = toAbsolutePath(join(ctx.paths.root, REGRESSION_DIR, "worktree"));
  ctx.git.run(["worktree", "remove", "--force", dir]);
  if (ctx.git.out(["worktree", "add", "--detach", "--force", dir, ctx.base]) === undefined)
    return { kind: "no_worktree" };
  try {
    for (const file of files) {
      const target = toAbsolutePath(join(dir, file));
      ctx.runtime.mkdir(toAbsolutePath(dirname(target)));
      ctx.runtime.writeText(target, readWorking(ctx, file) ?? "");
    }
    const at = { ...ctx, paths: { ...ctx.paths, root: dir }, baseline: undefined };
    return { kind: "ran", outcome: runShellCheck(check, run, at) };
  } finally {
    ctx.git.run(["worktree", "remove", "--force", dir]);
  }
};

const cacheKey = (ctx: GateContext, run: string, files: readonly string[]): string =>
  sha256Hex([ctx.base, run, ...files.map((file) => `${file}\u0000${readWorking(ctx, file) ?? ""}`)].join("\n"));

const cachedStatus = (ctx: GateContext, key: string): string | undefined => {
  const raw = readJsonFile(ctx.runtime, ctx.paths.cache(CACHE_FILE));
  return raw?.["key"] === key && typeof raw["status"] === "string" ? raw["status"] : undefined;
};

const baseStatus = (ctx: GateContext, check: AcceptanceCheck, run: string, files: readonly string[]) => {
  const key = cacheKey(ctx, run, files);
  const cached = cachedStatus(ctx, key);
  if (cached !== undefined) return cached;
  const result = runOnBase(ctx, check, run, files);
  const status = result.kind === "ran" ? result.outcome.status : "no_worktree";
  if (status === "passed" || status === "failed")
    writeJsonFile(ctx.runtime, ctx.paths.cache(CACHE_FILE), { key, status });
  return status;
};

export const regressionCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, REGRESSION_GUARD);
  if (mode === "off") return passed([note("gate.regression.off")]);
  if (!isFixTask(ctx)) return passed([note("gate.regression.not_fix")]);
  const files = newTestFiles(ctx).filter(isTestFile);
  if (files.length === 0) return passed([note("gate.regression.no_new_test")]);
  const tests = ctx.contract.acceptance.find((item) => item.kind === "tests" && item.run !== undefined);
  if (tests?.run === undefined) return unverified("no_evidence", [note("gate.regression.no_command")]);
  const status = baseStatus(ctx, tests, tests.run, files);
  logEvent(ctx.runtime, ctx.paths, "tests.regression", { task: ctx.contract.id, mode, status, files: [...files] });
  const listed = { files: files.join(", "), command: tests.run };
  if (status === "failed") return passed([note("gate.regression.proven", listed)]);
  if (status !== "passed") return unverified("tool_missing", [note("gate.regression.unavailable", listed)]);
  const notes = [note("gate.regression.not_proven", listed)];
  return mode === "shadow" ? passed(notes) : failed([...notes, note("gate.regression.fix")]);
};
