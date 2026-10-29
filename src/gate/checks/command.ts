import { nowMs } from "../../core/clock.js";
import type { ExecResult } from "../../core/runtime.js";
import type { Note } from "../../evidence/types.js";
import { readApprovals } from "../../guards/release/grants.js";
import { parseShell } from "../../guards/shell.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import { sha256Hex as sha256 } from "../../secrets/fingerprint.js";
import type { AcceptanceCheck } from "../../task/types.js";
import {
  exitZeroAdded,
  looksLikeTest,
  masksExit,
  pinnedChanges,
  referenceCount,
  TEST_PIN_FEATURE,
} from "../test-pin.js";
import { parseTestSummary } from "../test-summary.js";
import { type CheckOutcome, failed, type GateContext, note, unverified } from "../types.js";

export const DEFAULT_CHECK_TIMEOUT_S = 600;
const MIN_REMAINING_MS = 1000;
const RATE_LIMIT = /\b429\b|rate.?limit|too many requests|quota exceeded|usage limit/i;
const REWRITERS = /^\s*(rtk)\b/;
const TRIVIAL = new Set(["echo", "true", ":", "printf", "exit", "sleep", "cat", "yes", "pwd", "ls", "date", "env"]);
const TAIL = 160;
const MAX_FAILURES = 5;

const tail = (text: string): string => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const last = lines[lines.length - 1]?.trim() ?? "";
  return last.length > TAIL ? `${last.slice(0, TAIL)}…` : last;
};

export const isTrivialCommand = (run: string): boolean => {
  const commands = parseShell(run);
  return commands.length === 0 || commands.every((command) => TRIVIAL.has(command.argv[0] ?? ""));
};

const failedRun = (check: AcceptanceCheck, ctx: GateContext, result: ExecResult): CheckOutcome => {
  const output = `${result.stdout}\n${result.stderr}`;
  const summary = parseTestSummary(output);
  const known = new Set(ctx.baseline?.[check.id]?.failures ?? []);
  const fresh = summary.failures.filter((name) => !known.has(name));
  const old = summary.failures.length - fresh.length;
  const baselineNote: readonly Note[] = old > 0 ? [note("gate.note.baseline", { count: old })] : [];
  if (summary.failures.length > 0 && fresh.length === 0) {
    return { status: "passed", notes: baselineNote, failures: summary.failures };
  }
  const last = ctx.mask(tail(output));
  return {
    status: "failed",
    failures: summary.failures,
    ...(summary.total === undefined ? {} : { testCount: summary.total }),
    notes: [
      note("gate.note.exit", { code: result.exitCode ?? -1 }),
      ...fresh.slice(0, MAX_FAILURES).map((name) => note("gate.note.new_failure", { name: ctx.mask(name) })),
      ...(fresh.length === 0 && last !== "" ? [note("gate.note.output", { line: last })] : []),
      ...baselineNote,
    ],
  };
};

const classify = (check: AcceptanceCheck, ctx: GateContext, result: ExecResult, timeoutMs: number): CheckOutcome => {
  const run = check.run ?? "";
  if (!result.found) return unverified("tool_missing", [note("gate.note.tool_missing", { command: run })]);
  if (result.timedOut)
    return unverified("timeout", [note("gate.note.timeout", { seconds: Math.round(timeoutMs / 1000) })]);
  if (result.exitCode !== 0 && RATE_LIMIT.test(`${result.stdout}\n${result.stderr}`)) {
    return unverified("rate_limited", [note("gate.note.rate_limited")]);
  }
  if (result.exitCode !== 0) return failedRun(check, ctx, result);
  const summary = parseTestSummary(`${result.stdout}\n${result.stderr}`);
  if (summary.total === 0) return failed([note("gate.note.zero_tests", { command: run })]);
  return {
    status: "passed",
    notes: [
      note("gate.note.exit", { code: 0 }),
      ...(summary.total === undefined ? [] : [note("gate.note.tests_ran", { count: summary.total })]),
    ],
    ...(summary.total === undefined ? {} : { testCount: summary.total }),
  };
};

const before = (check: AcceptanceCheck, ctx: GateContext, run: string): CheckOutcome | undefined => {
  if (masksExit(run)) return unverified("masked_exit", [note("gate.pin.masked", { command: run })]);
  const approved = readApprovals(ctx.runtime, ctx.paths).some(
    (item) => item.task === ctx.contract.id && item.check === check.id,
  );
  const changed = approved ? [] : pinnedChanges(ctx, run);
  if (changed.length === 0) return undefined;
  return unverified("needs_approval", [
    ...changed.slice(0, MAX_FAILURES).map((item) => note("gate.pin.changed", { key: item.key, diff: item.diff })),
    note("gate.pin.approve", { task: ctx.contract.id, check: check.id }),
  ]);
};

const after = (check: AcceptanceCheck, ctx: GateContext, run: string, outcome: CheckOutcome): CheckOutcome => {
  if (outcome.status !== "passed" || !looksLikeTest(run)) return outcome;
  if (outcome.testCount === undefined)
    return unverified("no_test_count", [note("gate.pin.no_count", { command: run })]);
  const reference = referenceCount(ctx, check.id, run);
  const drop =
    reference !== undefined && outcome.testCount < reference
      ? [note("gate.pin.count_drop", { before: reference, after: outcome.testCount })]
      : [];
  const exits = exitZeroAdded(ctx)
    .slice(0, MAX_FAILURES)
    .map((where) => note("gate.pin.exit_zero", { where }));
  return drop.length + exits.length === 0 ? outcome : failed([...drop, ...exits]);
};

const shadowed = (ctx: GateContext, check: AcceptanceCheck, real: CheckOutcome, pinned: CheckOutcome): CheckOutcome => {
  if (pinned === real) return real;
  recordFeatureShadow(ctx.runtime, ctx.paths, TEST_PIN_FEATURE, {
    check: check.id,
    wouldBe: pinned.status,
    reason: pinned.reason ?? null,
  });
  return { ...real, notes: [...real.notes, ...pinned.notes, note("gate.pin.shadow", { status: pinned.status })] };
};

const executeShell = (check: AcceptanceCheck, run: string, ctx: GateContext): CheckOutcome => {
  const remaining = ctx.deadline - nowMs(ctx.runtime);
  if (remaining < MIN_REMAINING_MS) return { ...unverified("budget", [note("gate.note.budget")]), command: run };
  const timeoutMs = Math.min(remaining, (check.timeoutS ?? DEFAULT_CHECK_TIMEOUT_S) * 1000);
  const result = ctx.runtime.exec({
    command: run,
    args: [],
    cwd: ctx.paths.root,
    timeoutMs,
    shell: true,
    env: { CI: "1" },
    unset: ["NODE_TEST_CONTEXT"],
  });
  return {
    command: run,
    exitCode: result.exitCode,
    stdoutSha256: sha256(result.stdout),
    durationMs: result.durationMs,
    ...classify({ ...check, run }, ctx, result, timeoutMs),
  };
};

export interface ShellOptions {
  readonly pin?: boolean;
}

export const runShellCheck = (
  check: AcceptanceCheck,
  run: string,
  ctx: GateContext,
  options: ShellOptions = {},
): CheckOutcome => {
  if (isTrivialCommand(run)) return { ...failed([note("gate.note.trivial", { command: run })]), command: run };
  if (!ctx.trusted)
    return { ...unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]), command: run };
  if (REWRITERS.test(run)) return { ...unverified("rewriter", [note("gate.note.rewriter")]), command: run };
  const mode = options.pin === false ? "off" : featureMode(ctx.runtime, ctx.paths, TEST_PIN_FEATURE);
  if (mode === "off") return executeShell(check, run, ctx);
  const held = before(check, ctx, run);
  if (held !== undefined && mode === "active") return { ...held, command: run };
  const real = executeShell(check, run, ctx);
  const pinned = held === undefined ? after(check, ctx, run, real) : { ...real, ...held };
  if (mode === "active") return pinned === real ? real : { ...real, ...pinned };
  return shadowed(ctx, check, real, pinned);
};

export const commandCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome =>
  check.run === undefined ? unverified("not_implemented") : runShellCheck(check, check.run, ctx);
