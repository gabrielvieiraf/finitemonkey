import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { featureMode } from "../policy/feature.js";
import { parseKind, PROVIDER_FEATURE, PROVIDER_KINDS, type ProviderKind } from "../provider/kinds.js";
import { estimateOf, providerLines, spentToday } from "../provider/ledger.js";
import { enabledKinds, maxUsdPerDay, PROVIDER_SCHEMA, setEnabled } from "../provider/store.js";
import { isPerson, personName } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const ENABLE_USAGE = "finitemonkey provider enable <kind> [--yes]";
const DISABLE_USAGE = "finitemonkey provider disable <kind>";

const money = (usd: number): string => `$${usd.toFixed(2)}`;

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const badKind = (ctx: Ctx, usage: string, value: string): CommandResult =>
  failureFrom(
    ctx.t,
    usageProblem("invalid_arguments", "provider.error.kind", usage, { kind: value, kinds: PROVIDER_KINDS.join(", ") }),
  );

const preview = (ctx: Ctx, paths: FmPaths, kind: ProviderKind): readonly string[] => {
  const estimate = estimateOf(ctx.runtime, paths, kind);
  return [
    ctx.t("provider.enable.title", { kind }),
    ctx.t("provider.enable.sends", { what: ctx.t(`provider.sends.${kind}`) }),
    ctx.t(estimate.source === "median" ? "provider.enable.estimate_median" : "provider.enable.estimate_default", {
      usd: money(estimate.usd),
      calls: estimate.calls,
    }),
    ctx.t("provider.enable.cap", { cap: money(maxUsdPerDay(ctx.runtime, paths)) }),
    ctx.t("provider.enable.login"),
  ];
};

const enable = (ctx: Ctx, raw: string): CommandResult => {
  const kind = parseKind(raw);
  if (kind === undefined) return badKind(ctx, ENABLE_USAGE, raw);
  const command = `fm provider enable ${kind} --yes`;
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("provider.error.person_only", command, { kind }));
  const paths = pathsOf(ctx);
  const lines = preview(ctx, paths, kind);
  const data = { schema: PROVIDER_SCHEMA, kind, enabled: false };
  if (!ctx.yes || ctx.dryRun) return { ...success(data, [...lines, ctx.t("provider.enable.confirm")]), next: command };
  if (!setEnabled(ctx.runtime, paths, kind, personName(ctx)))
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "provider.error.write", command));
  const mode = featureMode(ctx.runtime, paths, PROVIDER_FEATURE);
  return success({ ...data, enabled: true, mode }, [
    ...lines,
    ctx.t("provider.enabled", { kind }),
    ctx.t(mode === "active" ? "provider.mode.active" : "provider.mode.shadow", { mode }),
  ]);
};

const disable = (ctx: Ctx, raw: string): CommandResult => {
  const kind = parseKind(raw);
  if (kind === undefined) return badKind(ctx, DISABLE_USAGE, raw);
  const paths = pathsOf(ctx);
  if (!setEnabled(ctx.runtime, paths, kind, undefined))
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "provider.error.write", DISABLE_USAGE));
  return success({ schema: PROVIDER_SCHEMA, kind, enabled: false }, [ctx.t("provider.disabled", { kind })]);
};

const list = (ctx: Ctx): CommandResult => {
  const paths = pathsOf(ctx);
  const enabled = enabledKinds(ctx.runtime, paths);
  const lines = providerLines(ctx.runtime, paths);
  const spent = spentToday(ctx.runtime, paths);
  const cap = maxUsdPerDay(ctx.runtime, paths);
  const kinds = PROVIDER_KINDS.map((kind) => {
    const own = lines.filter((line) => line.kind === kind);
    return {
      kind,
      enabled: enabled.some((entry) => entry.kind === kind),
      calls: own.length,
      usd: own.reduce((total, line) => total + line.usd, 0),
      estimateUsd: estimateOf(ctx.runtime, paths, kind).usd,
    };
  });
  const mode = featureMode(ctx.runtime, paths, PROVIDER_FEATURE);
  return success({ schema: PROVIDER_SCHEMA, mode, spentToday: spent, maxUsdPerDay: cap, capped: spent >= cap, kinds }, [
    ...kinds.map((item) =>
      ctx.t(item.enabled ? "provider.list.on" : "provider.list.off", {
        kind: item.kind,
        calls: item.calls,
        usd: money(item.usd),
        estimate: money(item.estimateUsd),
      }),
    ),
    ctx.t("provider.list.today", { spent: money(spent), cap: money(cap), mode }),
    ...(spent >= cap ? [ctx.t("provider.capped", { cap: money(cap) })] : []),
  ]);
};

export const providerEnableCommand: CommandSpec = {
  path: ["provider", "enable"],
  summaryKey: "command.provider_enable.summary",
  usage: ENABLE_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(enable(ctx, args.positionals[0] ?? "")),
};

export const providerDisableCommand: CommandSpec = {
  path: ["provider", "disable"],
  summaryKey: "command.provider_disable.summary",
  usage: DISABLE_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(disable(ctx, args.positionals[0] ?? "")),
};

export const providerListCommand: CommandSpec = {
  path: ["provider", "list"],
  summaryKey: "command.provider_list.summary",
  usage: "finitemonkey provider list",
  status: "ready",
  run: (ctx) => Promise.resolve(list(ctx)),
};
