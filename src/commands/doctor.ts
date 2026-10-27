import { dirname, join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, toEnvelope } from "../core/result.js";
import { applyFixes, type Fixed } from "../doctor/fix.js";
import { hookInventory, type HookRow, withDebugLog } from "../doctor/hook-inventory.js";
import { reportMarkdown, reportPath } from "../doctor/report-file.js";
import { buildReport, doctorEnvFrom, type DoctorItem, type DoctorReport, runChecks } from "../doctor/run.js";
import { ExitCode } from "../exit-codes.js";
import { applyProblem, planProblem } from "../install/session.js";
import type { CommandSpec } from "./types.js";

const MARK = { ok: "ok  ", warn: "warn", fail: "FAIL" } as const;

const itemLines = (ctx: Pick<Ctx, "t">, item: DoctorItem): readonly string[] => [
  `[${MARK[item.status]}] ${item.check}: ${item.detail}`,
  ...(item.fix !== undefined && item.status !== "ok" ? [`       ${ctx.t("output.fix", { fix: item.fix })}`] : []),
];

export interface DoctorData extends DoctorReport {
  readonly fixed?: Fixed;
  readonly reportPath?: string;
  readonly hookInventory?: readonly HookRow[];
}

const debugLog = (ctx: Ctx): string | undefined => {
  const dir = ctx.env["CLAUDE_CONFIG_DIR"] ?? join(ctx.runtime.homeDir(), ".claude");
  const text = ctx.runtime.readText(toAbsolutePath(join(dir, "debug", "latest")));
  return text.ok ? text.value : undefined;
};

const cellOf = (value: number | null, unit: string): string => (value === null ? "?" : `${String(value)} ${unit}`);

const inventoryLines = (ctx: Ctx, rows: readonly HookRow[]): readonly string[] => [
  ctx.t("doctor.hooks.inventory", { count: rows.length }),
  ...rows.map(
    (row) =>
      `  ${row.event.padEnd(17)}${row.source.padEnd(28)}${row.failMode.padEnd(12)}${cellOf(row.latencyMs, "ms").padEnd(9)}${cellOf(row.outputBytes, "B").padEnd(9)}${row.blocksStop ? "stop " : "     "}${row.enabled ? "" : "(disabled) "}${row.command}`,
  ),
];

export const doctorResult = (
  ctx: Pick<Ctx, "t" | "version">,
  report: DoctorData,
  extra: readonly string[] = [],
): CommandResult<DoctorData> => {
  const human = [
    ctx.t("doctor.title", { version: ctx.version }),
    ...extra,
    ...report.checks.flatMap((item) => itemLines(ctx, item)),
    ctx.t("doctor.summary", report.summary),
  ];
  const failed = report.checks.find((item) => item.status === "fail");
  if (failed === undefined) return { ok: true, exitCode: ExitCode.Ok, data: report, human };
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data: report,
    human,
    error: {
      code: "doctor_failed",
      message: ctx.t("error.doctor_failed", { count: report.summary.fail }),
      fix: failed.fix ?? "finitemonkey doctor",
    },
  };
};

const fixLines = (ctx: Ctx, fixed: Fixed): readonly string[] => {
  if (!fixed.installed) return [ctx.t("doctor.fix.not_installed")];
  if (fixed.written.length === 0) return [ctx.t("doctor.fix.nothing")];
  const files = fixed.written.join(", ");
  if (ctx.dryRun) return [ctx.t("doctor.fix.would", { files })];
  return [
    ctx.t("doctor.fix.applied", { files }),
    ...(fixed.backup === undefined ? [] : [ctx.t("doctor.fix.backup", { path: fixed.backup })]),
  ];
};

const manualLines = (ctx: Ctx, report: DoctorReport): readonly string[] =>
  report.checks.some((item) => item.status !== "ok" && item.fix !== undefined) ? [ctx.t("doctor.fix.manual")] : [];

const writeReport = (ctx: Ctx, data: DoctorData, result: CommandResult<DoctorData>): CommandResult<DoctorData> => {
  const env = doctorEnvFrom(ctx);
  const path = reportPath(env);
  const text = reportMarkdown(env, ctx, toEnvelope("doctor", result));
  const dir = ctx.runtime.mkdir(toAbsolutePath(dirname(path)));
  const written = dir.ok ? ctx.runtime.writeAtomic(path, text) : dir;
  if (!written.ok) return failureFrom(ctx.t, applyProblem({ path, detail: written.error }));
  const human = [...(result.human ?? []), ctx.t("doctor.report.written", { path })];
  return { ...result, data: { ...data, reportPath: path }, human };
};

const runDoctor = (ctx: Ctx, fix: boolean, report: boolean, hooks: boolean): CommandResult<DoctorData> => {
  let extra: readonly string[] = [];
  let fixed: Fixed | undefined;
  if (fix) {
    const applied = applyFixes(ctx, !ctx.dryRun);
    if (!applied.ok) {
      const problem =
        applied.error.kind === "plan" ? planProblem(applied.error.error) : applyProblem(applied.error.error);
      return failureFrom(ctx.t, problem);
    }
    fixed = applied.value;
    extra = fixLines(ctx, fixed);
  }
  const env = doctorEnvFrom(ctx);
  const checked = buildReport(ctx, runChecks(env));
  const rows = hooks ? withDebugLog(hookInventory(env), debugLog(ctx)) : undefined;
  const base: DoctorData = rows === undefined ? checked : { ...checked, hookInventory: rows };
  const data: DoctorData = fixed === undefined ? base : { ...base, fixed };
  const lines = [
    ...(fix ? [...extra, ...manualLines(ctx, checked)] : extra),
    ...(rows === undefined ? [] : inventoryLines(ctx, rows)),
  ];
  const result = doctorResult(ctx, data, lines);
  return report ? writeReport(ctx, data, result) : result;
};

export const doctorCommand: CommandSpec = {
  path: ["doctor"],
  summaryKey: "command.doctor.summary",
  usage: "finitemonkey doctor [--hooks] [--fix] [--report] [--dry-run] [--json]",
  status: "ready",
  options: { fix: { type: "boolean" }, report: { type: "boolean" }, hooks: { type: "boolean" } },
  run: (ctx, args) =>
    Promise.resolve(
      runDoctor(ctx, args.values["fix"] === true, args.values["report"] === true, args.values["hooks"] === true),
    ),
};
