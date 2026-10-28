import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { fmPaths } from "../task/paths.js";
import { loadInventory } from "../wt/inventory.js";
import { cleanableOf, dismiss, readClasses, writeClasses } from "../wt/suggest.js";
import { notRepository } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const WT_CLASSES_SCHEMA = "finitemonkey/wt-classes@1";

const classify = (ctx: Ctx): CommandResult => {
  const inventory = loadInventory(ctx.runtime, ctx.cwd, undefined);
  if (inventory === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const worktrees = writeClasses(ctx.runtime, paths, inventory);
  const cleanable = cleanableOf({ at: ctx.runtime.now(), startedAt: undefined, worktrees });
  return success({ schema: WT_CLASSES_SCHEMA, worktrees, cleanable }, [
    ctx.t("wt.classify.done", { count: worktrees.length, cleanable: cleanable.count }),
  ]);
};

const dismissLine = (ctx: Ctx): CommandResult => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const cached = readClasses(ctx.runtime, paths);
  const count = cached === undefined ? 0 : cleanableOf(cached).count;
  dismiss(ctx.runtime, paths, count);
  logEvent(ctx.runtime, paths, "wt.dismissed", { count });
  return success({ schema: WT_CLASSES_SCHEMA, dismissed: count }, [ctx.t("wt.dismiss.done", { count })]);
};

export const wtClassifyCommand: CommandSpec = {
  path: ["wt", "classify"],
  summaryKey: "wt.command.classify",
  usage: "finitemonkey wt classify",
  status: "ready",
  run: (ctx) => Promise.resolve(classify(ctx)),
};

export const wtDismissCommand: CommandSpec = {
  path: ["wt", "dismiss"],
  summaryKey: "wt.command.dismiss",
  usage: "finitemonkey wt dismiss",
  status: "ready",
  run: (ctx) => Promise.resolve(dismissLine(ctx)),
};
