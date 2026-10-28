import { type AuditFinding, auditRepo, CI_AUDIT_CHECK } from "../ci/audit/audit.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { loadBaseline, ratchetFor } from "../findings/baseline.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import { projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { baselineInvalid } from "./secrets-problems.js";
import type { CommandSpec } from "./types.js";

export const CI_AUDIT_SCHEMA = "finitemonkey/ci-audit@1";
export const CI_AUDIT_FEATURE = "ci-audit";

type Status = "new" | "known" | "expired";

export interface CiAuditData {
  readonly schema: typeof CI_AUDIT_SCHEMA;
  readonly mode: GuardMode;
  readonly level: number;
  readonly files: readonly string[];
  readonly missingTools: readonly string[];
  readonly findings: readonly (AuditFinding & { readonly status: Status })[];
}

const itemLine = (ctx: Ctx, item: CiAuditData["findings"][number]): string =>
  ctx.t("ci.audit.item", {
    severity: item.severity,
    status: item.status,
    where: `${item.file}:${String(item.line)}`,
    rule: item.rule,
    detail: item.detail,
    id: item.id,
  });

const statusOf = (fresh: ReadonlySet<string>, expired: ReadonlySet<string>, id: string): Status =>
  fresh.has(id) ? "new" : expired.has(id) ? "expired" : "known";

const run = (ctx: Ctx): CommandResult<CiAuditData> => {
  const root = projectRoot(ctx);
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, CI_AUDIT_FEATURE);
  const empty = { schema: CI_AUDIT_SCHEMA, mode, level: 0, files: [], missingTools: [], findings: [] } as const;
  if (mode === "off") return success(empty, [ctx.t("gen.off", { feature: CI_AUDIT_FEATURE })]);
  const baseline = loadBaseline(ctx.runtime, root);
  if (!baseline.ok) return failureFrom(ctx.t, baselineInvalid(baseline.error));
  const report = auditRepo(ctx.runtime, root);
  const outcome = ratchetFor(CI_AUDIT_CHECK, report.findings, baseline.value, ctx.runtime.now(), undefined);
  const fresh = new Set(outcome.fresh.map((item) => item.id));
  const expired = new Set(outcome.expired.map((item) => item.id));
  const findings = report.findings.map((item) => ({ ...item, status: statusOf(fresh, expired, item.id) }));
  const data: CiAuditData = {
    ...empty,
    level: report.level,
    files: report.files,
    missingTools: report.missingTools,
    findings,
  };
  const human = [
    ctx.t("ci.audit.title", { count: report.files.length, level: report.level }),
    ...findings.map((item) => `  ${itemLine(ctx, item)}`),
    ...(report.missingTools.length === 0
      ? []
      : [ctx.t("ci.audit.tools_missing", { tools: report.missingTools.join(", ") })]),
  ];
  const blocking = findings.filter((item) => item.severity === "block" && item.status !== "known");
  if (blocking.length === 0) return success(data, [...human, ctx.t("ci.audit.clean")]);
  if (mode === "shadow") {
    recordFeatureShadow(ctx.runtime, paths, CI_AUDIT_FEATURE, { findings: blocking.map((item) => item.id) });
    return success(data, [...human, ctx.t("gen.shadow", { feature: CI_AUDIT_FEATURE })]);
  }
  return failureFrom(
    ctx.t,
    {
      code: "ci_audit_failed",
      messageKey: "ci.audit.failed",
      params: { count: blocking.length },
      fix: "fix each blocking line, or accept one with finitemonkey findings accept <finding-id> --reason <why>",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

export const ciAuditCommand: CommandSpec = {
  path: ["ci", "audit"],
  summaryKey: "ci.command.audit",
  usage: "finitemonkey ci audit",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(run(ctx)),
};
