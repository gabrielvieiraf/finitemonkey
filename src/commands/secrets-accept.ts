import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import {
  BASELINE_FILE,
  type BaselineEntry,
  EXCEPTION_MAX_DAYS,
  loadBaseline,
  saveBaseline,
} from "../secrets/baseline.js";
import { type LocatedFinding, whereOf } from "../secrets/located.js";
import { isPerson, personName, projectRoot } from "../secrets/project.js";
import { scanPath } from "../secrets/scan.js";
import { baselineInvalid, writeFailed } from "./secrets-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";

const DAY_MS = 86_400_000;

const daysOf = (values: OptionValues): number | undefined => {
  const raw = stringOption(values, "days");
  if (raw === undefined) return EXCEPTION_MAX_DAYS;
  const days = Number.parseInt(raw, 10);
  return Number.isInteger(days) && days > 0 && days <= EXCEPTION_MAX_DAYS ? days : undefined;
};

const plusDays = (iso: string, days: number): string => new Date(Date.parse(iso) + days * DAY_MS).toISOString();

const failure = (ctx: Ctx, problem: Problem): CommandResult => failureFrom(ctx.t, problem);

const inputProblem = (
  ctx: Ctx,
  id: string,
  reason: string | undefined,
  days: number | undefined,
): Problem | undefined => {
  const fix = "finitemonkey secrets accept <id> --reason <why> [--days 1-90] [--false-positive]";
  if (!isPerson(ctx)) {
    return needsPersonProblem("secrets.error.person_only", fix, { action: ctx.t("secrets.action.accept") });
  }
  if (id === "") return usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail: "<id>" });
  if (reason === undefined || reason.trim() === "") {
    return usageProblem("invalid_arguments", "secrets.error.reason_required", fix);
  }
  if (days === undefined) {
    return usageProblem("invalid_arguments", "error.invalid_arguments", fix, {
      detail: `--days 1-${String(EXCEPTION_MAX_DAYS)}`,
    });
  }
  return undefined;
};

interface AcceptArgs {
  readonly id: string;
  readonly reason: string;
  readonly days: number;
  readonly falsePositive: boolean;
}

const entryOf = (ctx: Ctx, finding: LocatedFinding, args: AcceptArgs): BaselineEntry => {
  const now = ctx.runtime.now();
  return {
    id: finding.id,
    rule: finding.ruleId,
    file: finding.file,
    line: finding.line,
    fingerprint: finding.fingerprint,
    state: args.falsePositive ? "falso-positivo" : "aceito",
    owner: personName(ctx),
    reason: args.reason,
    acceptedAt: now,
    expiresAt: plusDays(now, args.days),
  };
};

const acceptEntry = (ctx: Ctx, args: AcceptArgs): CommandResult => {
  const root = projectRoot(ctx);
  const baseline = loadBaseline(ctx.runtime, root);
  if (!baseline.ok) {
    return failure(ctx, baselineInvalid(baseline.error));
  }
  const scanned = scanPath(ctx.runtime, root, ".");
  const finding = scanned.ok ? scanned.value.find((item) => item.id === args.id) : undefined;
  if (finding === undefined) {
    return failure(
      ctx,
      usageProblem("secrets_finding_not_found", "secrets.error.finding_not_found", "finitemonkey secrets scan", {
        id: args.id,
      }),
    );
  }
  const entry = entryOf(ctx, finding, args);
  const entries = [...baseline.value.entries.filter((item) => item.id !== entry.id), entry];

  const saved = saveBaseline(ctx.runtime, root, { schema: baseline.value.schema, entries });
  if (!saved.ok) {
    return failure(ctx, writeFailed(BASELINE_FILE, saved.error));
  }
  const line = ctx.t("secrets.accept.done", {
    id: entry.id,
    rule: entry.rule,
    where: whereOf(finding),
    state: entry.state,
    expires: entry.expiresAt.slice(0, 10),
    owner: entry.owner,
  });
  return success(entry, [line]);
};

export const secretsAcceptCommand: CommandSpec = {
  path: ["secrets", "accept"],
  summaryKey: "secrets.command.accept",
  usage: "finitemonkey secrets accept <finding-id> --reason <why> [--days 1-90] [--false-positive]",
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" }, days: { type: "string" }, "false-positive": { type: "boolean" } },
  run: (ctx, args) => {
    const id = args.positionals[0] ?? "";
    const reason = stringOption(args.values, "reason");
    const days = daysOf(args.values);
    const problem = inputProblem(ctx, id, reason, days);
    if (problem !== undefined || reason === undefined || days === undefined) {
      return Promise.resolve(
        failure(
          ctx,
          problem ??
            usageProblem("invalid_arguments", "secrets.error.reason_required", "finitemonkey help secrets accept"),
        ),
      );
    }
    return Promise.resolve(
      acceptEntry(ctx, { id, reason, days, falsePositive: args.values["false-positive"] === true }),
    );
  },
};
