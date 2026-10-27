import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { projectRoot } from "../secrets/project.js";
import { osvOutcome, osvRequest } from "../supply/osv.js";
import { judge, type JudgedVuln, readSeen, writeSeen } from "../supply/verdict.js";
import type { CommandSpec } from "./types.js";

export const DEPS_SCAN_SCHEMA = "finitemonkey/deps-scan@1";

export interface DepsScanData {
  readonly schema: typeof DEPS_SCAN_SCHEMA;
  readonly vulnerabilities: readonly JudgedVuln[];
  readonly blocking: number;
}

const INSTALL_FIX =
  "install osv-scanner (https://google.github.io/osv-scanner/installation/) and run the command again";

const line = (ctx: Ctx, vuln: JudgedVuln): string => {
  const params = {
    name: vuln.name,
    version: vuln.version,
    id: vuln.id,
    severity: vuln.severity,
    fixed: vuln.fixed ?? "",
    deadline: vuln.deadline.slice(0, 10),
  };
  if (vuln.verdict === "warn") return ctx.t("deps.scan.warn", params);
  return ctx.t(vuln.fixed === undefined ? "deps.scan.block_late" : "deps.scan.block_fixed", params);
};

export const runDepsScan = (ctx: Ctx): CommandResult<DepsScanData> => {
  const root = projectRoot(ctx);
  const outcome = osvOutcome(ctx.runtime.exec(osvRequest(root)));
  if (outcome.kind === "missing")
    return failureFrom(ctx.t, {
      code: "deps_scanner_missing",
      messageKey: "deps.scan.missing",
      params: {},
      fix: INSTALL_FIX,
      exitCode: ExitCode.NotConfigured,
    });
  if (outcome.kind === "failed")
    return failureFrom(ctx.t, {
      code: "deps_scan_failed",
      messageKey: "deps.scan.failed",
      params: { detail: outcome.detail },
      fix: "run osv-scanner --recursive . to see the error",
      exitCode: ExitCode.CheckFailed,
    });
  const vulnerabilities = judge(outcome.vulns, readSeen(ctx.runtime, root), ctx.runtime.now());
  writeSeen(ctx.runtime, root, vulnerabilities);
  const blocking = vulnerabilities.filter((vuln) => vuln.verdict === "block").length;
  const data: DepsScanData = { schema: DEPS_SCAN_SCHEMA, vulnerabilities, blocking };
  const human = vulnerabilities.map((vuln) => line(ctx, vuln));
  if (blocking === 0) return success(data, human.length === 0 ? [ctx.t("deps.scan.clean")] : human);
  return failureFrom(
    ctx.t,
    {
      code: "deps_vulnerable",
      messageKey: "deps.scan.blocked",
      params: { count: blocking },
      fix: "upgrade the packages listed as blocking, then run finitemonkey deps scan again",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

export const depsScanCommand: CommandSpec = {
  path: ["deps", "scan"],
  summaryKey: "deps.command.scan",
  usage: "finitemonkey deps scan",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(runDepsScan(ctx)),
};
