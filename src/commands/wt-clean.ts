import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { archiveWorktree } from "../wt/archive.js";
import { CLEANUP_CLASSES, type CleanupClass } from "../wt/classify.js";
import { applyClean, cleanPlan, DEFAULT_INCLUDE, type PlanItem } from "../wt/clean.js";
import { classifyAll, findWorktree } from "../wt/inventory.js";
import { DEFAULT_ARCHIVE_DAYS, purgeRefs, safetyRefs } from "../wt/purge.js";
import { patchEntry } from "../wt/store.js";
import { notRepository } from "./git-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";
import { inventoryOf } from "./wt-list.js";

export const WT_CLEAN_SCHEMA = "finitemonkey/wt-clean@1";

const includeOf = (values: OptionValues): readonly CleanupClass[] => {
  const raw = stringOption(values, "include");
  if (raw === undefined) return DEFAULT_INCLUDE;
  const wanted = raw.split(",").map((item) => item.trim());
  return CLEANUP_CLASSES.filter((cls) => wanted.includes(cls) && DEFAULT_INCLUDE.includes(cls));
};

const itemLine = (ctx: Ctx, item: PlanItem & { readonly done?: boolean; readonly detail?: string }): string =>
  ctx.t("wt.clean.row", {
    action: item.action,
    cls: item.cls,
    branch: item.branch ?? "-",
    path: item.path,
    detail: item.detail === undefined || item.detail === "" ? "" : ` (${item.detail})`,
  });

export const wtCleanCommand: CommandSpec = {
  path: ["wt", "clean"],
  summaryKey: "wt.command.clean",
  usage: "finitemonkey wt clean [--apply] [--include contained,equivalent,orphan] [--reap] [--stale-days <n>] [--json]",
  status: "ready",
  options: {
    apply: { type: "boolean" },
    include: { type: "string" },
    reap: { type: "boolean" },
    "stale-days": { type: "string" },
  },
  run: (ctx, args): Promise<CommandResult> => {
    const inventory = inventoryOf(ctx, args.values);
    if (inventory === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const include = includeOf(args.values);
    if (args.values["apply"] !== true) {
      const plan = cleanPlan(inventory, include);
      return Promise.resolve(
        success({ schema: WT_CLEAN_SCHEMA, applied: false, items: plan }, [
          ctx.t("wt.clean.plan_title", { count: plan.length }),
          ...plan.map((item) => itemLine(ctx, item)),
          ctx.t("wt.clean.plan_next"),
        ]),
      );
    }
    const applied = applyClean(inventory, include, args.values["reap"] === true);
    const items = applied.ok ? applied.value : [];
    return Promise.resolve(
      success({ schema: WT_CLEAN_SCHEMA, applied: true, items }, [
        ctx.t("wt.clean.applied_title", { count: items.filter((item) => item.done).length }),
        ...items.map((item) => itemLine(ctx, item)),
      ]),
    );
  },
};

export const wtArchiveCommand: CommandSpec = {
  path: ["wt", "archive"],
  summaryKey: "wt.command.archive",
  usage: "finitemonkey wt archive <id|branch|path> [--keep] [--json]",
  status: "ready",
  options: { keep: { type: "boolean" } },
  maxPositionals: 1,
  run: (ctx, args): Promise<CommandResult> => {
    const inventory = inventoryOf(ctx, args.values);
    if (inventory === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const wanted = args.positionals[0] ?? "";
    const item = wanted === "" ? undefined : findWorktree(classifyAll(inventory), wanted, ctx.cwd);
    if (item?.tree === undefined) {
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("wt_not_found", "wt.error.not_found", "finitemonkey wt list", { id: wanted })),
      );
    }
    const removeTree = args.values["keep"] !== true;
    const archived = archiveWorktree(ctx.runtime, {
      path: item.path,
      id: item.entry?.id ?? wanted,
      branch: item.branch,
      mainRoot: inventory.mainRoot,
      remove: removeTree,
      deleteBranch: removeTree && (item.cls === "contained" || item.cls === "equivalent"),
      generated: inventory.context.generated,
    });
    if (!archived.ok) {
      return Promise.resolve(
        failureFrom(ctx.t, {
          ...usageProblem("wt_failed", "wt.error.git", "finitemonkey wt doctor", { detail: archived.error }),
          exitCode: ExitCode.CheckFailed,
        }),
      );
    }
    patchEntry(ctx.runtime, inventory.commonDir, item.path, {
      ...(removeTree ? { status: "archived" as const } : {}),
      archive: archived.value.ref,
    });
    const outcome = archived.value;
    return Promise.resolve(
      success({ schema: WT_CLEAN_SCHEMA, archive: outcome }, [
        ctx.t("wt.archive.done", { ref: outcome.ref, path: item.path }),
        ...(outcome.copiedTo === null
          ? []
          : [ctx.t("wt.archive.copied", { count: outcome.copied.length, dir: outcome.copiedTo })]),
        ...outcome.secrets.map((file) => ctx.t("wt.archive.secret", { file })),
      ]),
    );
  },
};

export const wtPurgeCommand: CommandSpec = {
  path: ["wt", "purge"],
  summaryKey: "wt.command.purge",
  usage: "finitemonkey wt purge [--days <n>] [--apply] [--json]",
  status: "ready",
  options: { days: { type: "string" }, apply: { type: "boolean" } },
  run: (ctx, args): Promise<CommandResult> => {
    const inventory = inventoryOf(ctx, args.values);
    if (inventory === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const parsed = Number.parseInt(stringOption(args.values, "days") ?? "", 10);
    const days = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_ARCHIVE_DAYS;
    const refs = safetyRefs(ctx.runtime, inventory.mainRoot, days);
    const expired = refs.filter((item) => item.expired);
    const removed = args.values["apply"] === true ? purgeRefs(ctx.runtime, inventory.mainRoot, expired) : [];
    return Promise.resolve(
      success({ schema: WT_CLEAN_SCHEMA, days, expired, removed }, [
        ctx.t("wt.purge.title", { count: expired.length, days }),
        ...expired.map((item) => ctx.t("wt.purge.row", { ref: item.ref, at: item.at })),
        ctx.t(args.values["apply"] === true ? "wt.purge.done" : "wt.purge.next", { count: removed.length }),
      ]),
    );
  },
};
