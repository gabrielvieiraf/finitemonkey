import { listOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { LOOK_CONFIG } from "../look/config.js";
import { type Critic, CRITIC_FEATURE, readCritique } from "../look/critic.js";
import { shownCritiques } from "../look/critic-show.js";
import { deepLines, type DeepReport } from "../look/deep.js";
import { deepRunner } from "../look/node-deep.js";
import { type LookRun, runLook } from "../look/run.js";
import { LOOK_SCHEMA, type LookRule } from "../look/types.js";
import { featureMode } from "../policy/feature.js";
import { providerCritic, whenEnabled } from "../provider/adapters.js";
import { providerDeps } from "../provider/wire.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const MAX_FINDINGS = 10;

export interface LookFindingBrief {
  readonly rule: LookRule;
  readonly route: string;
  readonly viewport: number;
  readonly detail: string;
  readonly blocking: boolean;
}

export interface LookData {
  readonly schema: typeof LOOK_SCHEMA;
  readonly treeHash: string;
  readonly failures: number;
  readonly notes: number;
  readonly captures: readonly string[];
  readonly contactSheet: string | null;
  readonly summary: string;
  readonly findings: readonly LookFindingBrief[];
  readonly deep?: DeepReport;
}

const setupError = (ctx: Ctx, run: Exclude<LookRun, { readonly kind: "done" }>): CommandResult => {
  const fix =
    run.kind === "playwright_missing" || run.kind === "browser_missing"
      ? "npm install --save-dev playwright && npx playwright install chromium"
      : run.kind === "not_configured"
        ? `echo "port: 3000" > ${LOOK_CONFIG}`
        : "finitemonkey look";
  const message = ctx.t(`look.error.${run.kind}`, { detail: run.kind === "app_failed" ? run.detail : "" });
  return {
    ok: false,
    exitCode: run.kind === "app_failed" ? ExitCode.CheckFailed : ExitCode.NotConfigured,
    human: [message],
    error: { code: run.kind === "app_failed" ? "look_failed" : "look_unavailable", message, fix },
  };
};

const dataOf = (run: Extract<LookRun, { readonly kind: "done" }>): LookData => ({
  schema: LOOK_SCHEMA,
  treeHash: run.summary.treeHash,
  failures: run.summary.failures,
  notes: run.summary.notes,
  captures: run.summary.captures.map((capture) => capture.path),
  contactSheet: run.summary.contactSheet,
  summary: run.summaryPath,
  findings: run.summary.findings
    .slice(0, MAX_FINDINGS)
    .map(({ rule, route, viewport, detail, blocking }) => ({ rule, route, viewport, detail, blocking })),
  ...(run.deep === undefined ? {} : { deep: run.deep }),
});

const deepHuman = (ctx: Ctx, deep: DeepReport | undefined): readonly string[] => {
  if (deep === undefined) return [];
  if (deep.tool === null) return [ctx.t("look.deep.absent")];
  return [ctx.t("look.deep.title"), ...deepLines(deep).map((line) => `  ${line}`)];
};

const opinions = (ctx: Ctx, tree: string): readonly string[] => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  if (featureMode(ctx.runtime, paths, CRITIC_FEATURE) !== "active") return [];
  return shownCritiques(ctx.runtime, paths, readCritique(ctx.runtime, paths, tree)?.critiques ?? []).map((item) =>
    ctx.t("look.opinion", {
      id: item.id,
      heuristic: item.heuristic,
      route: item.route,
      viewport: item.viewport,
      text: item.text,
    }),
  );
};

const doneResult = (ctx: Ctx, data: LookData): CommandResult<LookData> => {
  const human = [
    ...data.captures,
    ...(data.contactSheet === null ? [] : [data.contactSheet]),
    ...data.findings.map((item) => `${item.rule} ${item.route} @${String(item.viewport)}: ${item.detail}`),
    ...deepHuman(ctx, data.deep),
    ctx.t("look.done", { failures: data.failures, count: data.captures.length }),
  ];
  if (data.failures === 0) return success(data, human);
  const message = ctx.t("look.done", { failures: data.failures, count: data.captures.length });
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human,
    error: { code: "look_failed", message, fix: "finitemonkey look" },
  };
};

const lookCritic = (ctx: Ctx): Critic | undefined =>
  whenEnabled(providerDeps(ctx, fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd)), "critic", providerCritic);

export const lookCommand: CommandSpec = {
  path: ["look"],
  summaryKey: "command.look.summary",
  usage: "finitemonkey look [--route <path>]... [--deep]",
  status: "ready",
  options: { route: { type: "string", multiple: true }, deep: { type: "boolean" } },
  run: async (ctx, args) => {
    const root = findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd;
    const run = await runLook(ctx.runtime, ctx.cwd, lookCritic(ctx), {
      routes: listOption(args.values, "route"),
      ...(args.values["deep"] === true ? { deep: deepRunner(ctx.runtime, root) } : {}),
    });
    if (run.kind !== "done") return setupError(ctx, run);
    const result = doneResult(ctx, dataOf(run));
    return { ...result, human: [...(result.human ?? []), ...opinions(ctx, run.summary.treeHash)] };
  },
};
