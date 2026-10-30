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
  withEntry,
} from "../findings/baseline.js";
import { findFinding } from "../findings/sources.js";
import { UX_FEATURES } from "../look/ux-features.js";
import { recordDismissal } from "../policy/budget.js";
import { isPerson, personName, projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { baselineInvalid, writeFailed } from "./secrets-problems.js";
import type { CommandSpec } from "./types.js";

export const FINDINGS_LIST_SCHEMA = "finitemonkey/findings-list@1";

const DAY_MS = 86_400_000;
const ACCEPT_USAGE =
  "finitemonkey findings accept <finding-id> --reason <why> [--days 1-90] [--owner <name>] [--false-positive]";

const fail = (ctx: Ctx, problem: Problem): CommandResult => failureFrom(ctx.t, problem);

const daysOf = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return EXCEPTION_MAX_DAYS;
  const days = Number.parseInt(raw, 10);
  return Number.isInteger(days) && days > 0 && days <= EXCEPTION_MAX_DAYS && String(days) === raw.trim()
    ? days
    : undefined;
};

const inputProblem = (ctx: Ctx, id: string, reason: string, days: number | undefined): Problem | undefined => {
  if (!isPerson(ctx))
    return needsPersonProblem("secrets.error.person_only", ACCEPT_USAGE, { action: ctx.t("secrets.action.accept") });
  if (id === "") return usageProblem("invalid_arguments", "error.invalid_arguments", ACCEPT_USAGE, { detail: "<id>" });
  if (reason.trim() === "") return usageProblem("invalid_arguments", "secrets.error.reason_required", ACCEPT_USAGE);
  if (days === undefined)
    return usageProblem("invalid_arguments", "error.invalid_arguments", ACCEPT_USAGE, {
      detail: `--days 1-${String(EXCEPTION_MAX_DAYS)}`,
    });
  return undefined;
};

const accept = (ctx: Ctx, id: string, reason: string, days: number, owner: string, falsePositive: boolean) => {
  const root = projectRoot(ctx);
  const baseline = loadBaseline(ctx.runtime, root);
  if (!baseline.ok) return fail(ctx, baselineInvalid(baseline.error));
  const finding = findFinding(ctx.runtime, root, id);
  if (finding === undefined)
    return fail(
      ctx,
      usageProblem("findings_not_found", "findings.error.not_found", "finitemonkey findings list", { id }),
    );
  const now = ctx.runtime.now();
  const entry: BaselineEntry = {
    ...finding,
    state: falsePositive ? "falso-positivo" : "aceito",
    owner,
    reason,
    acceptedAt: now,
    expiresAt: new Date(Date.parse(now) + days * DAY_MS).toISOString(),
  };
  const saved = saveBaseline(ctx.runtime, root, withEntry(baseline.value, entry));
  if (!saved.ok) return fail(ctx, writeFailed(BASELINE_FILE, saved.error));
  if (falsePositive && UX_FEATURES.some((feature) => feature === finding.check))
    recordDismissal(ctx.runtime, fmPaths(root), finding.rule);
  return success(entry, [
    ctx.t("findings.accept.done", {
      id: entry.id,
      check: entry.check,
      rule: entry.rule,
      where: `${entry.file}:${String(entry.line)}`,
      owner: entry.owner,
      expires: entry.expiresAt.slice(0, 10),
    }),
  ]);
};

export const findingsAcceptCommand: CommandSpec = {
  path: ["findings", "accept"],
  summaryKey: "findings.command.accept",
  usage: ACCEPT_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    reason: { type: "string" },
    days: { type: "string" },
    owner: { type: "string" },
    "false-positive": { type: "boolean" },
  },
  run: (ctx, args) => {
    const id = args.positionals[0] ?? "";
    const reason = stringOption(args.values, "reason") ?? "";
    const days = daysOf(stringOption(args.values, "days"));
    const problem = inputProblem(ctx, id, reason, days);
    if (problem !== undefined || days === undefined)
      return Promise.resolve(
        fail(
          ctx,
          problem ?? usageProblem("invalid_arguments", "error.invalid_arguments", ACCEPT_USAGE, { detail: "--days" }),
        ),
      );
    const owner = stringOption(args.values, "owner") ?? personName(ctx);
    return Promise.resolve(accept(ctx, id, reason, days, owner, args.values["false-positive"] === true));
  },
};

export interface FindingsListData {
  readonly schema: typeof FINDINGS_LIST_SCHEMA;
  readonly entries: readonly (BaselineEntry & { readonly expired: boolean })[];
}

export const findingsListCommand: CommandSpec = {
  path: ["findings", "list"],
  summaryKey: "findings.command.list",
  usage: "finitemonkey findings list",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const baseline = loadBaseline(ctx.runtime, projectRoot(ctx));
    if (!baseline.ok) return Promise.resolve(fail(ctx, baselineInvalid(baseline.error)));
    const now = ctx.runtime.now();
    const entries = baseline.value.entries.map((entry) => ({ ...entry, expired: entry.expiresAt < now }));
    const data: FindingsListData = { schema: FINDINGS_LIST_SCHEMA, entries };
    const human =
      entries.length === 0
        ? [ctx.t("findings.list.empty")]
        : entries.map((entry) =>
            ctx.t(entry.expired ? "findings.list.expired" : "findings.list.entry", {
              id: entry.id,
              check: entry.check,
              where: `${entry.file}:${String(entry.line)}`,
              owner: entry.owner,
              expires: entry.expiresAt.slice(0, 10),
            }),
          );
    return Promise.resolve(success(data, human));
  },
};
