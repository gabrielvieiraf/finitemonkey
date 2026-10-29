import { stringOption } from "../core/args.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { buildMap, MAP_FILE, mapBudget } from "../map/build.js";
import { FM_DIR } from "../task/paths.js";
import { gitProblem, notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const MAP_SCHEMA = "finitemonkey/map@1";

const USAGE = "finitemonkey map [--budget <characters>]";
const MIN_BUDGET = 200;

const budgetOf = (raw: string | undefined): number | undefined | "invalid" => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= MIN_BUDGET ? parsed : "invalid";
};

export const mapCommand: CommandSpec = {
  path: ["map"],
  summaryKey: "command.map.summary",
  usage: USAGE,
  status: "ready",
  options: { budget: { type: "string" } },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const override = budgetOf(stringOption(args.values, "budget"));
    if (override === "invalid")
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, {
            detail: `--budget >= ${String(MIN_BUDGET)}`,
          }),
        ),
      );
    const map = buildMap(ctx.runtime, repo.root, mapBudget(ctx.runtime, repo.root, override));
    if (map === undefined)
      return Promise.resolve(
        failureFrom(ctx.t, gitProblem("map_unavailable", "map.error.git", repo.root, "git status")),
      );
    const data = { schema: MAP_SCHEMA, file: `${FM_DIR}/${MAP_FILE}`, ...map };
    const edited = (map.edited ?? []).map((line) => ctx.t("map.edited", { line }));
    return Promise.resolve(
      success(data, [...edited, ...(map.text === "" ? [ctx.t("map.empty")] : map.text.split("\n"))]),
    );
  },
};
