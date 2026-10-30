import { dirname, join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { matchesAny } from "../../core/glob.js";
import { logEvent } from "../../evidence/log.js";
import { configList, loadProjectConfig } from "../../git/project-config.js";
import { isTestFile } from "../../guards/tests/patterns.js";
import { experimentArm } from "../../policy/experiment.js";
import { featureMode } from "../../policy/feature.js";
import { loadPolicy } from "../../policy/policy.js";
import { readWorking } from "../../quality/gate-sources.js";
import { sha256Hex } from "../../secrets/fingerprint.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { removeScratch, scratchDir } from "../isolated.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";
import { newTestFiles } from "./regression.js";

export const RED_GREEN_FEATURE = "red-green";
const CACHE_FILE = "red-green.json";
const RUN_TIMEOUT_MS = 300_000;

export type RedOutcome = "red" | "never_red" | "compile_only" | "unavailable";

const COMPILE =
  /SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|error TS\d+|Cannot find name|does not provide an export|is not exported|Unexpected token|compilation failed|cannot find symbol/i;
const ASSERTION =
  /AssertionError|assert(?:ion)?[\s_]*(?:failed|error)|\bexpected\b|toBe|toEqual|assert_eq|AssertionFailedError/i;

export const classifyRed = (exitCode: number | null, output: string): RedOutcome => {
  if (exitCode === 0) return "never_red";
  return ASSERTION.test(output) && !COMPILE.test(output) ? "red" : "compile_only";
};

export const appliesTo = (ctx: GateContext, globs: readonly string[]): boolean =>
  ctx.contract.testsFirst === true ||
  (globs.length > 0 && ctx.changes.some((change) => matchesAny(change.path, globs)));

const redKey = (ctx: GateContext, run: string, files: readonly string[]): string =>
  sha256Hex([ctx.base, run, ...files.map((file) => `${file}\u0000${readWorking(ctx, file) ?? ""}`)].join("\n"));

const runOnBase = (ctx: GateContext, run: string, files: readonly string[]): RedOutcome => {
  const dir = scratchDir(ctx.runtime, ctx.paths.root, "red");
  const added = ctx.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, ctx.base], ctx.paths.root, {});
  if (!added.ok) return "unavailable";
  try {
    for (const file of files) {
      const target = toAbsolutePath(join(dir, file));
      ctx.runtime.mkdir(toAbsolutePath(dirname(target)));
      ctx.runtime.writeText(target, readWorking(ctx, file) ?? "");
    }
    const result = ctx.runtime.exec({
      command: run,
      args: [],
      cwd: dir,
      shell: true,
      timeoutMs: RUN_TIMEOUT_MS,
      env: { CI: "1" },
      unset: ["NODE_TEST_CONTEXT"],
    });
    return !result.found || result.timedOut
      ? "unavailable"
      : classifyRed(result.exitCode, `${result.stdout}\n${result.stderr}`);
  } finally {
    removeScratch(ctx.runtime, ctx.paths.root, dir);
  }
};

const redOf = (
  ctx: GateContext,
  run: string,
  files: readonly string[],
): { readonly key: string; readonly outcome: RedOutcome } => {
  const key = redKey(ctx, run, files);
  const cached = readJsonFile(ctx.runtime, ctx.paths.cache(CACHE_FILE));
  if (cached?.["key"] === key && typeof cached["outcome"] === "string") {
    const outcome = (["red", "never_red", "compile_only"] as const).find((item) => item === cached["outcome"]);
    if (outcome !== undefined) return { key, outcome };
  }
  const outcome = runOnBase(ctx, run, files);
  if (outcome !== "unavailable") writeJsonFile(ctx.runtime, ctx.paths.cache(CACHE_FILE), { key, outcome });
  return { key, outcome };
};

export const redGreenCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, RED_GREEN_FEATURE);
  const arm = experimentArm(ctx.runtime, ctx.paths, loadPolicy(ctx.runtime, ctx.paths.root), RED_GREEN_FEATURE);
  if (mode === "off") {
    if (arm !== undefined)
      logEvent(ctx.runtime, ctx.paths, "red_green", { task: ctx.contract.id, arm, mode, outcome: null });
    return passed([note("gate.red_green.off")]);
  }
  if (!appliesTo(ctx, configList(loadProjectConfig(ctx.runtime, ctx.paths.root), "red_green", "paths"))) {
    return passed([note("gate.red_green.not_opted")]);
  }
  const files = newTestFiles(ctx).filter(isTestFile);
  if (files.length === 0) return passed([note("gate.red_green.no_new_test")]);
  const tests = ctx.contract.acceptance.find((item) => item.kind === "tests" && item.run !== undefined);
  if (tests?.run === undefined) return unverified("no_evidence", [note("gate.red_green.no_command")]);
  if (!ctx.trusted) return unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]);
  const red = redOf(ctx, tests.run, files);
  logEvent(ctx.runtime, ctx.paths, "red_green", {
    task: ctx.contract.id,
    arm: arm ?? null,
    mode,
    outcome: red.outcome,
    redKey: red.key,
    greenTree: ctx.treeHash,
    files: [...files],
  });
  const params = { files: files.join(", "), red: red.key.slice(0, 12), green: ctx.treeHash.slice(0, 12) };
  if (red.outcome === "red") return passed([note("gate.red_green.proven", params)]);
  if (red.outcome === "unavailable") return unverified("tool_missing", [note("gate.red_green.unavailable", params)]);
  const notes = [note(`gate.red_green.${red.outcome}`, params)];
  return mode === "shadow" ? passed([note("gate.red_green.shadow"), ...notes]) : failed(notes);
};
