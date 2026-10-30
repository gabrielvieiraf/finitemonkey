import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { agreement, readPairs, writePairs } from "../look/critic.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const LOOK_PAIRS_SCHEMA = "finitemonkey/look-pairs@1";
const USAGE = "finitemonkey look pair pick <id> <a|b>";

const choiceOf = (raw: string | undefined): "a" | "b" | undefined => (raw === "a" || raw === "b" ? raw : undefined);

const pick = (ctx: Ctx, id: string | undefined, raw: string | undefined): CommandResult => {
  const choice = choiceOf(raw);
  if (id === undefined || choice === undefined)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: raw ?? "" }),
    );
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("look.approve.person_only", USAGE));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const pairs = readPairs(ctx.runtime, paths);
  if (!pairs.some((pair) => pair.id === id))
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "look.pair.unknown", "finitemonkey look pair", { id }));
  const next = pairs.map((pair) => (pair.id === id ? { ...pair, person: choice } : pair));
  writePairs(ctx.runtime, paths, next);
  const score = agreement(next);
  logEvent(ctx.runtime, paths, "ui_critic_pick", { id, person: choice, ...score });
  return success({ schema: LOOK_PAIRS_SCHEMA, pairs: next, ...score }, [
    ctx.t("look.pair.picked", { id, choice, agreed: score.agreed, decided: score.decided }),
  ]);
};

export const lookPairCommand: CommandSpec = {
  path: ["look", "pair"],
  summaryKey: "command.look_pair.summary",
  usage: "finitemonkey look pair",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const pairs = readPairs(ctx.runtime, fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd));
    const score = agreement(pairs);
    return Promise.resolve(
      success({ schema: LOOK_PAIRS_SCHEMA, pairs, ...score }, [
        ...pairs.map((pair) =>
          ctx.t("look.pair.line", { id: pair.id, critic: pair.critic, person: pair.person ?? "-" }),
        ),
        ctx.t("look.pair.agreement", { agreed: score.agreed, decided: score.decided }),
      ]),
    );
  },
};

export const lookPairPickCommand: CommandSpec = {
  path: ["look", "pair", "pick"],
  summaryKey: "command.look_pair_pick.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => Promise.resolve(pick(ctx, args.positionals[0], args.positionals[1])),
};
