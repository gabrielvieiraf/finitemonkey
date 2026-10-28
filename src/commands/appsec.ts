import { scanRepo } from "../appsec/scan.js";
import { SEMGREP_FILE, semgrepRules } from "../appsec/semgrep.js";
import { detectStack, type Stack } from "../appsec/stack.js";
import { APPSEC_CHECK, type AppsecFinding, OWASP } from "../appsec/types.js";
import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import {
  BASELINE_FILE,
  type BaselineEntry,
  EXCEPTION_MAX_DAYS,
  loadBaseline,
  ratchetFor,
  saveBaseline,
} from "../findings/baseline.js";
import { isPerson, personName, projectRoot } from "../secrets/project.js";
import { baselineInvalid, writeFailed } from "./secrets-problems.js";
import type { CommandSpec } from "./types.js";

export const APPSEC_SCAN_SCHEMA = "finitemonkey/appsec-scan@1";

const SCAN_USAGE = "finitemonkey appsec scan [--accept-existing --reason <why>]";
const DAY_MS = 86_400_000;

type Status = "new" | "known" | "expired";

export interface AppsecScanData {
  readonly schema: typeof APPSEC_SCAN_SCHEMA;
  readonly stack: Stack;
  readonly findings: readonly (AppsecFinding & { readonly status: Status; readonly owaspName: string })[];
  readonly accepted: number;
}

const readFile = (ctx: Ctx, root: ReturnType<typeof projectRoot>) => (relative: string) => {
  const text = ctx.runtime.readText(toAbsolutePath(relative, root));
  return text.ok ? text.value : undefined;
};

const line = (ctx: Ctx, item: AppsecScanData["findings"][number]): string =>
  ctx.t("appsec.scan.item", {
    status: item.status,
    where: `${item.file}:${String(item.line)}`,
    rule: item.rule,
    owasp: item.owaspName,
    id: item.id,
  });

const acceptAll = (ctx: Ctx, fresh: readonly AppsecFinding[], reason: string): readonly BaselineEntry[] => {
  const now = ctx.runtime.now();
  const expiresAt = new Date(Date.parse(now) + EXCEPTION_MAX_DAYS * DAY_MS).toISOString();
  const owner = personName(ctx);
  return fresh.map((finding) => ({
    check: finding.check,
    id: finding.id,
    rule: finding.rule,
    file: finding.file,
    line: finding.line,
    fingerprint: finding.fingerprint,
    state: "aceito",
    owner,
    reason,
    acceptedAt: now,
    expiresAt,
  }));
};

const runScan = (ctx: Ctx, acceptExisting: boolean, reason: string): CommandResult => {
  const root = projectRoot(ctx);
  const baseline = loadBaseline(ctx.runtime, root);
  if (!baseline.ok) return failureFrom(ctx.t, baselineInvalid(baseline.error));
  const found = scanRepo(ctx.runtime, root);
  const outcome = ratchetFor(APPSEC_CHECK, found, baseline.value, ctx.runtime.now(), undefined);
  const added = acceptExisting ? acceptAll(ctx, outcome.fresh, reason) : [];
  if (added.length > 0) {
    const saved = saveBaseline(ctx.runtime, root, {
      ...baseline.value,
      entries: [...baseline.value.entries, ...added],
    });
    if (!saved.ok) return failureFrom(ctx.t, writeFailed(BASELINE_FILE, saved.error));
  }
  const freshIds = new Set(acceptExisting ? [] : outcome.fresh.map((item) => item.id));
  const expiredIds = new Set(outcome.expired.map((item) => item.id));
  const statusOf = (id: string): Status => (freshIds.has(id) ? "new" : expiredIds.has(id) ? "expired" : "known");
  const findings = found.map((item) => ({ ...item, status: statusOf(item.id), owaspName: OWASP[item.owasp] }));
  const data: AppsecScanData = {
    schema: APPSEC_SCAN_SCHEMA,
    stack: detectStack(readFile(ctx, root)),
    findings,
    accepted: added.length,
  };
  const human = [
    ...findings.map((item) => line(ctx, item)),
    ...(added.length > 0 ? [ctx.t("appsec.scan.accepted", { count: added.length, file: BASELINE_FILE })] : []),
  ];
  const blocking = findings.filter((item) => item.status !== "known").length;
  if (blocking === 0) return success(data, human.length === 0 ? [ctx.t("appsec.scan.clean")] : human);
  return failureFrom(
    ctx.t,
    {
      code: "appsec_found",
      messageKey: "appsec.scan.blocked",
      params: { count: blocking },
      fix: "fix the findings, list public routes in .finitemonkey/routes-public.yml, or have the person accept them with finitemonkey findings accept",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

export const appsecScanCommand: CommandSpec = {
  path: ["appsec", "scan"],
  summaryKey: "appsec.command.scan",
  usage: SCAN_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { "accept-existing": { type: "boolean" }, reason: { type: "string" } },
  run: (ctx, args) => {
    const acceptExisting = args.values["accept-existing"] === true;
    const reason = stringOption(args.values, "reason") ?? "";
    if (acceptExisting && !isPerson(ctx))
      return Promise.resolve(
        failureFrom(
          ctx.t,
          needsPersonProblem("secrets.error.person_only", SCAN_USAGE, { action: ctx.t("secrets.action.accept") }),
        ),
      );
    if (acceptExisting && reason.trim() === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "secrets.error.reason_required", SCAN_USAGE)),
      );
    return Promise.resolve(runScan(ctx, acceptExisting, reason));
  },
};

export const appsecRulesCommand: CommandSpec = {
  path: ["appsec", "rules"],
  summaryKey: "appsec.command.rules",
  usage: "finitemonkey appsec rules [--write]",
  status: "ready",
  maxPositionals: 0,
  options: { write: { type: "boolean" } },
  run: (ctx, args) => {
    const root = projectRoot(ctx);
    const stack = detectStack(readFile(ctx, root));
    const text = semgrepRules(stack);
    const data = { schema: "finitemonkey/appsec-rules@1", stack, file: SEMGREP_FILE, text };
    if (args.values["write"] !== true)
      return Promise.resolve(success(data, [text, ctx.t("appsec.rules.preview", { file: SEMGREP_FILE })]));
    const made = ctx.runtime.mkdir(toAbsolutePath(".finitemonkey/semgrep", root));
    const saved = made.ok ? ctx.runtime.writeText(toAbsolutePath(SEMGREP_FILE, root), text) : made;
    if (!saved.ok) return Promise.resolve(failureFrom(ctx.t, writeFailed(SEMGREP_FILE, saved.error)));
    return Promise.resolve(success(data, [ctx.t("appsec.rules.written", { file: SEMGREP_FILE })]));
  },
};
