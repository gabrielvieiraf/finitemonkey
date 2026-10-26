import { stringOption } from "../core/args.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import type { Parsed } from "../core/parsed.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { maskToken } from "../mask/mask.js";
import {
  type Baseline,
  BASELINE_FILE,
  type InScope,
  loadBaseline,
  ratchet,
  type RatchetResult,
  saveBaseline,
  withoutFixed,
} from "../secrets/baseline.js";
import { HOOK_ACTOR } from "../secrets/guards/exposure.js";
import { recordIncident } from "../secrets/incidents.js";
import { type LocatedFinding, whereOf } from "../secrets/located.js";
import { projectRoot } from "../secrets/project.js";
import { ruleById } from "../secrets/rules/catalog.js";
import { scanHistory, type ScanMode, scanPath, scanStaged } from "../secrets/scan.js";
import { baselineInvalid, gitUnavailable } from "./secrets-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const SECRETS_SCAN_SCHEMA = "finitemonkey/secrets-scan@1";

export type FindingStatus = "new" | "known" | "expired";

export interface ScanFindingView {
  readonly id: string;
  readonly rule: string;
  readonly severity: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly fingerprint: string;
  readonly mask: string;
  readonly status: FindingStatus;
  readonly commit?: string;
}

export interface SecretsScanData {
  readonly schema: typeof SECRETS_SCAN_SCHEMA;
  readonly mode: ScanMode;
  readonly baseline: string;
  readonly findings: readonly ScanFindingView[];
  readonly fixed: readonly string[];
  readonly incidents: readonly string[];
  readonly summary: {
    readonly total: number;
    readonly new: number;
    readonly known: number;
    readonly expired: number;
    readonly fixed: number;
  };
}

const view = (finding: LocatedFinding, status: FindingStatus): ScanFindingView => ({
  id: finding.id,
  rule: finding.ruleId,
  severity: finding.severity,
  file: finding.file,
  line: finding.line,
  column: finding.column,
  fingerprint: finding.fingerprint,
  mask: maskToken(finding),
  status,
  ...(finding.commit === undefined ? {} : { commit: finding.commit }),
});

const modeOf = (values: OptionValues): ScanMode | undefined => {
  const chosen = [values["staged"] === true, values["history"] === true, stringOption(values, "path") !== undefined];
  if (chosen.filter(Boolean).length > 1) return undefined;
  if (chosen[0] === true) return "staged";
  return chosen[1] === true ? "history" : "path";
};

const normalizedTarget = (target: string): string =>
  target
    .replace(/\\/g, "/")
    .replace(/^\.\/?/, "")
    .replace(/\/$/, "");

const scopeOf = (target: string): InScope => {
  const prefix = normalizedTarget(target);
  return (file) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`);
};

const runScan = async (
  ctx: Ctx,
  root: AbsolutePath,
  mode: ScanMode,
  target: string,
): Promise<Parsed<readonly LocatedFinding[]>> => {
  if (mode === "staged") return scanStaged(ctx.runtime, root);
  if (mode === "history") return scanHistory(ctx.runtime, root);
  return scanPath(ctx.runtime, root, normalizedTarget(target) || ".");
};

const historyIncidents = (ctx: Ctx, root: AbsolutePath, fresh: readonly LocatedFinding[]): readonly string[] =>
  fresh.flatMap((finding) => {
    if (ruleById(finding.ruleId)?.kind !== "credential") return [];
    const draft = {
      rule: finding.ruleId,
      fingerprint: finding.fingerprint,
      where: whereOf(finding),
      source: "history" as const,
      state: "aberto" as const,
      ...(finding.commit === undefined ? {} : { firstCommit: finding.commit }),
    };
    const saved = recordIncident(ctx.runtime, root, draft, HOOK_ACTOR);
    return saved.ok ? [saved.value.id] : [];
  });

const dataOf = (mode: ScanMode, outcome: RatchetResult, incidents: readonly string[]): SecretsScanData => {
  const findings = [
    ...outcome.fresh.map((finding) => view(finding, "new")),
    ...outcome.known.map((finding) => view(finding, "known")),
    ...outcome.expired.map((finding) => view(finding, "expired")),
  ];
  return {
    schema: SECRETS_SCAN_SCHEMA,
    mode,
    baseline: BASELINE_FILE,
    findings,
    fixed: outcome.fixed.map((entry) => entry.id),
    incidents,
    summary: {
      total: findings.length,
      new: outcome.fresh.length,
      known: outcome.known.length,
      expired: outcome.expired.length,
      fixed: outcome.fixed.length,
    },
  };
};

const humanOf = (ctx: Ctx, data: SecretsScanData): readonly string[] => [
  ctx.t("secrets.scan.title", { mode: data.mode, ...data.summary }),
  ...data.findings.map((item) =>
    ctx.t("secrets.scan.item", {
      status: item.status,
      rule: item.rule,
      where: `${item.file}:${String(item.line)}`,
      id: item.id,
      mask: item.mask,
    }),
  ),
  ...(data.summary.total === 0 ? [ctx.t("secrets.scan.clean")] : []),
];

const resultOf = (ctx: Ctx, data: SecretsScanData): CommandResult<SecretsScanData> => {
  const human = humanOf(ctx, data);
  const failing = data.findings.filter((item) => item.status !== "known" && item.severity !== "warning").length;
  if (failing === 0) return success(data, human);
  return failureFrom(
    ctx.t,
    {
      code: "secrets_found",
      messageKey: "secrets.error.found",
      params: { count: failing },
      fix: "finitemonkey secrets accept <id> --reason <why>",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

const prune = (ctx: Ctx, root: AbsolutePath, baseline: Baseline, outcome: RatchetResult): void => {
  if (outcome.fixed.length > 0) saveBaseline(ctx.runtime, root, withoutFixed(baseline, outcome.fixed));
};

export const secretsScanCommand: CommandSpec = {
  path: ["secrets", "scan"],
  summaryKey: "secrets.command.scan",
  usage: "finitemonkey secrets scan [--staged | --history | --path <dir>] [--json]",
  status: "ready",
  options: { staged: { type: "boolean" }, history: { type: "boolean" }, path: { type: "string" } },
  run: async (ctx, args): Promise<CommandResult> => {
    const mode = modeOf(args.values);
    const fix = "finitemonkey help secrets scan";
    if (mode === undefined) return failureFrom(ctx.t, usageProblem("invalid_arguments", "secrets.error.one_mode", fix));
    const root = projectRoot(ctx);
    const target = stringOption(args.values, "path") ?? ".";
    const scanned = await runScan(ctx, root, mode, target);
    if (!scanned.ok) return failureFrom(ctx.t, gitUnavailable(scanned.error));
    const baseline = loadBaseline(ctx.runtime, root);
    if (!baseline.ok) return failureFrom(ctx.t, baselineInvalid(baseline.error));
    const outcome = ratchet(
      scanned.value,
      baseline.value,
      ctx.runtime.now(),
      mode === "path" ? scopeOf(target) : undefined,
    );
    if (mode === "path") prune(ctx, root, baseline.value, outcome);
    const incidents = mode === "history" ? historyIncidents(ctx, root, outcome.fresh) : [];
    return resultOf(ctx, dataOf(mode, outcome, incidents));
  },
};
