import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { BLUEPRINTS } from "../planta/blueprints.js";
import { type BlueprintBar, evaluateBlueprint } from "../planta/evaluate.js";
import { barLines, howChecked, itemText } from "../planta/render.js";
import { activeBlueprint, approvedItems, readCachedBar, recordInContract, writeCachedBar } from "../planta/store.js";
import { BLUEPRINT_TYPES, type BlueprintType, parseBlueprintType } from "../planta/types.js";
import { projectView } from "../planta/view.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const PLANTA_SCHEMA = "finitemonkey/planta@1";

const USAGE = `finitemonkey planta [${BLUEPRINT_TYPES.join("|")}]`;

const itemsJson = (ctx: Ctx, bar: BlueprintBar): readonly Readonly<Record<string, unknown>>[] =>
  bar.items.map((item) => {
    const probe = BLUEPRINTS[bar.type].find((entry) => entry.id === item.id)?.probe;
    return {
      ...item,
      ...itemText(ctx.lang, item.id),
      how: probe === undefined ? "" : howChecked(ctx.t, item.id, probe),
    };
  });

const chosenType = (ctx: Ctx, raw: string | undefined, paths: ReturnType<typeof fmPaths>): BlueprintType | undefined =>
  raw === undefined
    ? (activeBlueprint(ctx.runtime, paths) ?? readCachedBar(ctx.runtime, paths)?.type)
    : parseBlueprintType(raw);

const runPlanta = (ctx: Ctx, raw: string | undefined): CommandResult => {
  const repo = repoOf(ctx);
  if (repo === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const paths = fmPaths(repo.root);
  const type = chosenType(ctx, raw, paths);
  if (type === undefined) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: raw ?? BLUEPRINT_TYPES.join("|") }),
    );
  }
  const task = raw === undefined ? undefined : recordInContract(ctx.runtime, paths, type);
  const bar = evaluateBlueprint(type, projectView(ctx.runtime, repo.root), approvedItems(ctx.runtime, paths));
  writeCachedBar(ctx.runtime, paths, bar);
  const installed =
    raw === undefined
      ? []
      : [
          task === undefined
            ? ctx.t("planta.installed.project", { type })
            : ctx.t("planta.installed.task", { type, task }),
        ];
  return success(
    {
      schema: PLANTA_SCHEMA,
      type,
      task: task ?? null,
      green: bar.green,
      total: bar.total,
      next: bar.next ?? null,
      tree: bar.tree ?? null,
      items: itemsJson(ctx, bar),
    },
    [...installed, ...barLines(ctx.t, ctx.lang, bar)],
  );
};

export const plantaCommand: CommandSpec = {
  path: ["planta"],
  summaryKey: "command.planta.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(runPlanta(ctx, args.positionals[0])),
};
