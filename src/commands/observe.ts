import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { readHosts, readLevel } from "../infra/file.js";
import { planFiles, type PlannedFile, projectFormat, writePlanned } from "../infra/plan-files.js";
import { scanInfra } from "../infra/scan.js";
import { filesFor, type ObserveRow, observeRows } from "../observe/items.js";
import { LOG_PATH, logModule, planFile, SCRUB_PATH, scrubModule } from "../observe/templates.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const OBSERVE_SCHEMA = "finitemonkey/observe@1";
export const OBSERVE_FEATURE = "observability";

const textFor = (path: string, level: number): string =>
  path === SCRUB_PATH ? scrubModule() : path === LOG_PATH ? logModule() : planFile(level);

const rowLine = (ctx: Ctx, row: ObserveRow): string =>
  ctx.t(`observe.state.${row.state}`, { item: ctx.t(`observe.item.${row.item}`), file: row.file ?? "-" });

const fileLines = (ctx: Ctx, planned: readonly PlannedFile[], written: number): readonly string[] => {
  const creates = planned.filter((file) => file.action === "create");
  return [
    ...creates.flatMap((file) => [
      ctx.t("deploy.generate.file.create", { file: file.path }),
      ...file.diff.map((line) => `    ${line}`),
    ]),
    ...planned
      .filter((file) => file.action === "differs")
      .map((file) => ctx.t("deploy.generate.file.differs", { file: file.path })),
    ctx.t(
      written > 0
        ? "deploy.generate.written"
        : creates.length > 0
          ? "deploy.generate.preview"
          : "deploy.generate.nothing",
      {
        count: written,
      },
    ),
  ];
};

const runObserve = (ctx: Ctx, root: AbsolutePath): CommandResult => {
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, OBSERVE_FEATURE);
  if (mode === "off") return success({ schema: OBSERVE_SCHEMA, mode }, [ctx.t("observe.off")]);
  const inventory = scanInfra(ctx.runtime, root, readHosts(ctx.runtime, root));
  const recorded = readLevel(ctx.runtime, root);
  const level = recorded?.source === "confirmed" ? recorded.level : inventory.level;
  const format = projectFormat(ctx.runtime, root);
  const planned = planFiles(
    ctx.runtime,
    root,
    filesFor(level).map((path) => ({ path, text: format(path, textFor(path, level)) })),
  );
  const rows = observeRows(level, inventory, (path) =>
    planned.some((file) => file.path === path && file.action !== "create"),
  );
  const creates = planned.filter((file) => file.action === "create");
  const apply = ctx.yes && !ctx.dryRun && mode === "active" && creates.length > 0;
  if (ctx.yes && mode === "shadow")
    recordFeatureShadow(ctx.runtime, paths, OBSERVE_FEATURE, { creates: creates.length });
  const written = apply ? writePlanned(ctx.runtime, root, planned, false).written : [];
  const human = [
    ctx.t("observe.title", { level }),
    ...rows.map((row) => rowLine(ctx, row)),
    ...fileLines(ctx, planned, written.length),
    ctx.t("observe.no_signup"),
  ];
  const data = {
    schema: OBSERVE_SCHEMA,
    level,
    items: rows,
    files: planned.map(({ path, action }) => ({ path, action })),
    written,
  };
  const result = success(data, human);
  return creates.length > 0 && !apply ? { ...result, next: "finitemonkey observe --yes" } : result;
};

export const observeCommand: CommandSpec = {
  path: ["observe"],
  summaryKey: "command.observe.summary",
  usage: "finitemonkey observe [--dry-run] [--yes]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const repo = repoOf(ctx);
    return Promise.resolve(
      repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : runObserve(ctx, repo.root),
    );
  },
};
