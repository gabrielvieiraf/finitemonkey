import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { rateOf } from "../look/copy-ledger.js";
import { acceptCritique, readCriticLedger } from "../look/critic-ledger.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const LOOK_OPINION_SCHEMA = "finitemonkey/look-opinion@1";
const USAGE = "finitemonkey look opinion accept <id>";

export interface LookOpinionData {
  readonly schema: typeof LOOK_OPINION_SCHEMA;
  readonly id: string;
  readonly heuristic: string;
  readonly accepted: number;
  readonly shown: number;
}

const accept = (ctx: Ctx, id: string | undefined): CommandResult => {
  if (id === undefined || id === "")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: "" }));
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("look.approve.person_only", USAGE));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const heuristic = acceptCritique(ctx.runtime, paths, id);
  if (heuristic === undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "look.opinion.unknown", USAGE, { id }));
  const rate = rateOf(readCriticLedger(ctx.runtime, paths)[heuristic] ?? { shown: {}, accepted: [] });
  logEvent(ctx.runtime, paths, "ui_critic_accept", { id, heuristic, ...rate });
  const data: LookOpinionData = { schema: LOOK_OPINION_SCHEMA, id, heuristic, ...rate };
  return success(data, [ctx.t("look.opinion.accepted", { id, heuristic, accepted: rate.accepted, shown: rate.shown })]);
};

export const lookOpinionAcceptCommand: CommandSpec = {
  path: ["look", "opinion", "accept"],
  summaryKey: "command.look_opinion_accept.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(accept(ctx, args.positionals[0])),
};
