import { parseAppCheck } from "../../app/parse.js";
import { type AppProbeResult, DEFAULT_APP_TIMEOUT_S, DEFAULT_ROUTE, DEFAULT_STATUS } from "../../app/types.js";
import { nowMs } from "../../core/clock.js";
import type { Note } from "../../evidence/types.js";
import { sha256Hex as sha256 } from "../../secrets/fingerprint.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const PROBE_MARGIN_MS = 15_000;
const MIN_REMAINING_MS = 5_000;
const TAIL = 160;

const lastLine = (text: string): string => {
  const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "" && !/^\s*at\s|^Node\.js v\d/.test(row));
  const line = (rows.findLast((row) => /error/i.test(row)) ?? rows.at(-1))?.trim() ?? "";
  return line.length > TAIL ? `${line.slice(0, TAIL)}…` : line;
};

const args = (check: AcceptanceCheck, timeoutS: number): readonly string[] => [
  "app",
  "check",
  "--json",
  "--port",
  String(check.port ?? 0),
  "--route",
  check.route ?? DEFAULT_ROUTE,
  "--status",
  String(check.status ?? DEFAULT_STATUS),
  "--timeout",
  String(timeoutS),
  ...(check.run === undefined ? [] : ["--start", check.run]),
  ...(check.body === undefined ? [] : ["--body", check.body]),
];

const resultNotes = (check: AcceptanceCheck, result: AppProbeResult, ctx: GateContext): readonly Note[] => {
  const route = check.route ?? DEFAULT_ROUTE;
  const line = ctx.mask(lastLine(result.output));
  const output = line === "" ? [] : [note("gate.note.output", { line })];
  switch (result.kind) {
    case "ok":
      return [note(result.reused ? "gate.runtime.reused" : "gate.runtime.ok", { route, status: result.status ?? 0 })];
    case "crashed":
      return [note("gate.runtime.crashed", { code: result.exitCode ?? -1 }), ...output];
    case "no_port":
      return [note("gate.runtime.no_port", { port: check.port ?? 0 }), ...output];
    case "no_start":
      return [note("gate.runtime.no_start", { port: check.port ?? 0 })];
    case "wrong_status":
      return [
        note("gate.runtime.wrong_status", {
          route,
          status: result.status ?? 0,
          expected: check.status ?? DEFAULT_STATUS,
        }),
      ];
    case "body_mismatch":
      return [note("gate.runtime.body_mismatch", { route, body: ctx.mask(check.body ?? "") })];
    case "request_failed":
      return [note("gate.runtime.request_failed", { route, detail: ctx.mask(result.bodyExcerpt ?? "") })];
  }
};

const outcome = (check: AcceptanceCheck, result: AppProbeResult, ctx: GateContext): CheckOutcome => {
  const notes = [
    ...resultNotes(check, result, ctx),
    ...(result.stopped ? [] : [note("gate.runtime.orphan", { port: check.port ?? 0 })]),
  ];
  const base = result.kind === "ok" && result.stopped ? passed(notes) : failed(notes);
  return {
    ...base,
    ...(check.run === undefined ? {} : { command: check.run }),
    exitCode: result.exitCode ?? (result.kind === "ok" ? 0 : null),
    stdoutSha256: sha256(result.output),
    durationMs: result.durationMs,
  };
};

export const runtimeCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  if (check.port === undefined) return failed([note("gate.runtime.no_port_declared")]);
  if (check.run !== undefined && !ctx.trusted)
    return { ...unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]), command: check.run };
  const remaining = ctx.deadline - nowMs(ctx.runtime) - PROBE_MARGIN_MS;
  if (remaining < MIN_REMAINING_MS) return unverified("budget", [note("gate.note.budget")]);
  const timeoutS = Math.max(1, Math.min(check.timeoutS ?? DEFAULT_APP_TIMEOUT_S, Math.floor(remaining / 1000)));
  const run = ctx.runtime.execSelf(args(check, timeoutS), ctx.paths.root, timeoutS * 1000 + PROBE_MARGIN_MS);
  if (run.timedOut) return unverified("timeout", [note("gate.note.timeout", { seconds: timeoutS })]);
  const result = parseAppCheck(run.stdout);
  if (result === undefined) {
    return failed([note("gate.runtime.probe_failed", { line: ctx.mask(lastLine(`${run.stdout}\n${run.stderr}`)) })]);
  }
  return outcome(check, result, ctx);
};
