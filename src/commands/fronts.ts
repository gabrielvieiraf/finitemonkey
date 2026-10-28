import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { applyWave, trackedFiles } from "../fronts/plan.js";
import { parseWavePlan } from "../fronts/plan-input.js";
import { refusals } from "../fronts/rules.js";
import { readFronts } from "../fronts/state.js";
import { statusTable, summarize } from "../fronts/status.js";
import { gitWorktrees } from "../wt/git-list.js";
import type { CommandSpec } from "./types.js";
import { commandOwner } from "./wt.js";

export const FRONTS_STATUS_SCHEMA = "finitemonkey/fronts-status@1";
export const FRONTS_PLAN_SCHEMA = "finitemonkey/fronts-plan@1";

export const mainRoot = (ctx: Pick<Ctx, "runtime" | "cwd">): AbsolutePath => {
  const main = gitWorktrees(ctx.runtime, ctx.cwd)?.find((tree) => tree.main);
  return main === undefined ? ctx.cwd : toAbsolutePath(main.path);
};

const failed = (
  ctx: Ctx,
  code: "fronts_refused" | "fronts_failed",
  key: Parameters<Ctx["t"]>[0],
  params: Readonly<Record<string, string | number>>,
  data?: unknown,
): CommandResult => ({
  ...failureFrom(ctx.t, {
    ...usageProblem(code, key, "finitemonkey fronts status", params),
    exitCode: ExitCode.CheckFailed,
  }),
  ...(data === undefined ? {} : { data }),
});

export const frontsPlanCommand: CommandSpec = {
  path: ["fronts", "plan"],
  summaryKey: "fronts.command.plan",
  usage: "finitemonkey fronts plan <plan.yml> [--apply] [--json]",
  status: "ready",
  options: { apply: { type: "boolean" } },
  maxPositionals: 1,
  run: (ctx, args): Promise<CommandResult> => {
    const file = args.positionals[0];
    const text = file === undefined ? undefined : ctx.runtime.readText(toAbsolutePath(file, ctx.cwd));
    if (text?.ok !== true)
      return Promise.resolve(failed(ctx, "fronts_failed", "fronts.error.no_plan", { file: file ?? "" }));
    const plan = parseWavePlan(text.value);
    if (!plan.ok) return Promise.resolve(failed(ctx, "fronts_failed", "fronts.error.bad_plan", { detail: plan.error }));
    const root = mainRoot(ctx);
    const found = refusals(plan.value, trackedFiles(ctx.runtime, root));
    const data = { schema: FRONTS_PLAN_SCHEMA, refusals: found, fronts: plan.value.fronts.map((front) => front.id) };
    if (found.length > 0) {
      const lines = found.map((item) =>
        ctx.t("fronts.refusal", { rule: item.rule, fronts: item.fronts.join(", "), detail: item.detail }),
      );
      return Promise.resolve({
        ...failed(ctx, "fronts_refused", "fronts.error.refused", { count: found.length }, data),
        human: lines,
      });
    }
    if (args.values["apply"] !== true) {
      return Promise.resolve(
        success(data, [ctx.t("fronts.plan.ok", { count: plan.value.fronts.length }), ctx.t("fronts.plan.next")]),
      );
    }
    const applied = applyWave({ runtime: ctx.runtime, cwd: root, env: ctx.env, owner: commandOwner(ctx) }, plan.value);
    if (!applied.ok)
      return Promise.resolve(failed(ctx, "fronts_failed", "fronts.error.apply", { detail: applied.error }));
    const summary = summarize(applied.value, ctx.runtime.now());
    return Promise.resolve(
      success({ ...data, wave: summary }, [
        ctx.t("fronts.plan.applied", { wave: applied.value.wave }),
        ...statusTable(summary),
      ]),
    );
  },
};

export const frontsStatusCommand: CommandSpec = {
  path: ["fronts", "status"],
  summaryKey: "fronts.command.status",
  usage: "finitemonkey fronts status [--json]",
  status: "ready",
  run: (ctx): Promise<CommandResult> => {
    const state = readFronts(ctx.runtime, mainRoot(ctx));
    if (!state.ok)
      return Promise.resolve(failed(ctx, "fronts_failed", "fronts.error.bad_state", { detail: state.error }));
    const summary = summarize(state.value, ctx.runtime.now());
    const head = ctx.t("fronts.status.head", {
      wave: summary.wave,
      base: summary.base === "" ? "-" : summary.base,
      running: summary.running,
      blocked: summary.blocked,
      cost: summary.costUsd.toFixed(2),
    });
    const next = summary.next.length === 0 ? [] : [ctx.t("fronts.status.next", { next: summary.next.join(", ") })];
    return Promise.resolve(
      success({ schema: FRONTS_STATUS_SCHEMA, ...summary }, [head, ...statusTable(summary), ...next]),
    );
  },
};
