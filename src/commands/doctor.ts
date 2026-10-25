import type { Ctx } from "../core/context.js";
import type { CommandResult } from "../core/result.js";
import { buildReport, doctorEnvFrom, type DoctorItem, type DoctorReport, runChecks } from "../doctor/run.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandSpec } from "./types.js";

const MARK = { ok: "ok  ", warn: "warn", fail: "FAIL" } as const;

const itemLines = (ctx: Pick<Ctx, "t">, item: DoctorItem): readonly string[] => [
  `[${MARK[item.status]}] ${item.check}: ${item.detail}`,
  ...(item.fix !== undefined && item.status !== "ok" ? [`       ${ctx.t("output.fix", { fix: item.fix })}`] : []),
];

export const doctorResult = (ctx: Pick<Ctx, "t" | "version">, report: DoctorReport): CommandResult<DoctorReport> => {
  const human = [
    ctx.t("doctor.title", { version: ctx.version }),
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

export const doctorCommand: CommandSpec = {
  path: ["doctor"],
  summaryKey: "command.doctor.summary",
  usage: "finitemonkey doctor [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(doctorResult(ctx, buildReport(ctx, runChecks(doctorEnvFrom(ctx))))),
};
