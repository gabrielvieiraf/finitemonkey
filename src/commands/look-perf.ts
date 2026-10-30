import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { latestTree } from "../look/approved.js";
import { acceptRegression, readPerf, writePerf } from "../look/perf.js";
import { isPerson, personName } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const LOOK_PERF_SCHEMA = "finitemonkey/look-perf-accept@1";
const USAGE = "finitemonkey look perf accept <route> --reason <why>";

const accept = (ctx: Ctx, route: string | undefined, reason: string): CommandResult => {
  if (!route?.startsWith("/") || reason === "")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: route ?? "--reason" }),
    );
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("look.approve.person_only", USAGE));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const store = readPerf(ctx.runtime, paths);
  const tree = latestTree(ctx.runtime, paths);
  if (tree === undefined || store.routes[route] === undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "look.perf.unknown", "finitemonkey look", { route }));
  const acceptance = { route, tree, reason, by: personName(ctx), at: ctx.runtime.now() };
  writePerf(ctx.runtime, paths, acceptRegression(store, acceptance));
  logEvent(ctx.runtime, paths, "look.perf_accepted", { route, tree, reason });
  return success({ schema: LOOK_PERF_SCHEMA, ...acceptance }, [
    ctx.t("look.perf.accepted", { route, tree: tree.slice(0, 12) }),
  ]);
};

export const lookPerfAcceptCommand: CommandSpec = {
  path: ["look", "perf", "accept"],
  summaryKey: "command.look_perf_accept.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" } },
  run: (ctx, args) =>
    Promise.resolve(accept(ctx, args.positionals[0], stringOption(args.values, "reason")?.trim() ?? "")),
};
