import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { historyLine } from "../evolve/render.js";
import { runEvolve } from "../evolve/run.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { readEvolve, writeEvolve } from "../policy/evolved.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const POLICY_EVOLVE_SCHEMA = "finitemonkey/policy-evolve@1";
export const POLICY_HISTORY_SCHEMA = "finitemonkey/policy-history@1";
const REVERT_USAGE = "finitemonkey policy revert <variant>";

const pathsOf = (ctx: Ctx): ReturnType<typeof fmPaths> => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

export const policyEvolveCommand: CommandSpec = {
  path: ["policy", "evolve"],
  summaryKey: "command.policy_evolve.summary",
  usage: "finitemonkey policy evolve [--record] [--json]",
  status: "ready",
  maxPositionals: 0,
  options: { record: { type: "boolean" } },
  run: (ctx, args) => {
    const result = runEvolve(ctx.runtime, pathsOf(ctx), args.values["record"] === true);
    return Promise.resolve(
      success({ schema: POLICY_EVOLVE_SCHEMA, ...result }, [
        ctx.t("evolve.run", {
          mode: result.mode,
          proposed: result.proposed.length,
          promoted: result.promoted.length,
          rejected: result.rejected.length,
          waiting: result.waiting.length,
        }),
        ...(result.halted.length === 0 ? [] : [ctx.t("evolve.halted", { variants: result.halted.join(", ") })]),
      ]),
    );
  },
};

export const policyHistoryCommand: CommandSpec = {
  path: ["policy", "history"],
  summaryKey: "command.policy_history.summary",
  usage: "finitemonkey policy history [--json]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const state = readEvolve(ctx.runtime, pathsOf(ctx).root);
    const lines = state.variants.map((variant) => historyLine(ctx.t, variant));
    return Promise.resolve(
      success(
        { schema: POLICY_HISTORY_SCHEMA, variants: state.variants },
        lines.length === 0 ? [ctx.t("evolve.history.none")] : lines,
      ),
    );
  },
};

const revert = (ctx: Ctx, id: string): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("evolve.error.person_only", REVERT_USAGE));
  const paths = pathsOf(ctx);
  const state = readEvolve(ctx.runtime, paths.root);
  const found = state.variants.find(
    (variant) => variant.id === id && (variant.status === "promoted" || variant.status === "trial"),
  );
  if (found === undefined)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", REVERT_USAGE, { detail: id }),
    );
  writeEvolve(ctx.runtime, paths.root, {
    variants: state.variants.map((variant) =>
      variant.id === id ? { ...variant, status: "reverted", decidedAt: ctx.runtime.now() } : variant,
    ),
    unseen: state.unseen.filter((item) => item !== id),
  });
  logEvent(ctx.runtime, paths, "policy_reverted", { variant: id, from: found.status });
  return success({ variant: id, from: found.status }, [ctx.t("evolve.reverted", { id })]);
};

export const policyRevertCommand: CommandSpec = {
  path: ["policy", "revert"],
  summaryKey: "command.policy_revert.summary",
  usage: REVERT_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(revert(ctx, args.positionals[0] ?? "")),
};
