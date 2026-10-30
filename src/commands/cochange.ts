import { stringOption } from "../core/args.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { gitAt } from "../gate/git.js";
import { dismissPair, historyOf } from "../git/cochange.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const COCHANGE_SCHEMA = "finitemonkey/cochange@1";
const USAGE = 'finitemonkey cochange dismiss <file> <partner> --reason "<why>"';

export const cochangeDismissCommand: CommandSpec = {
  path: ["cochange", "dismiss"],
  summaryKey: "command.cochange_dismiss.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 2,
  options: { reason: { type: "string" } },
  run: (ctx, args) => {
    const [file, partner] = args.positionals;
    const reason = stringOption(args.values, "reason")?.trim() ?? "";
    if (file === undefined || partner === undefined || reason === "") {
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "cochange.error.usage", USAGE)));
    }
    if (!isPerson(ctx)) return Promise.resolve(failureFrom(ctx.t, needsPersonProblem("cochange.error.person", USAGE)));
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const paths = fmPaths(repo.root);
    const commits = historyOf(ctx.runtime, paths, gitAt(ctx.runtime, repo.root));
    const dismissal = dismissPair(ctx.runtime, paths, commits, [file, partner], reason);
    return Promise.resolve(
      success({ schema: COCHANGE_SCHEMA, file, partner, ...dismissal }, [
        ctx.t("cochange.dismissed", { file, partner, support: dismissal.support }),
      ]),
    );
  },
};
