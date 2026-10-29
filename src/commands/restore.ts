import { nowMs } from "../core/clock.js";
import type { Ctx } from "../core/context.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { evidenceHash, isStale, reachFindings, RESTORE_FEATURE, restoreConfig, runDrill } from "../db/restore.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { loadProjectConfig } from "../git/project-config.js";
import { featureMode } from "../policy/feature.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const RESTORE_SCHEMA = "finitemonkey/restore@1";

const inRepo = (ctx: Ctx, run: (paths: FmPaths) => CommandResult): Promise<CommandResult> => {
  const repo = repoOf(ctx);
  return Promise.resolve(repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : run(fmPaths(repo.root)));
};

const restoreProblem = <T>(count: number, data: T): Problem<T> => ({
  code: "restore_failed",
  messageKey: "restore.failed",
  params: { count },
  fix: "move the backup out of reach of the app credentials, or run `finitemonkey restore drill`",
  exitCode: ExitCode.CheckFailed,
  data,
});

export const lastPassedDrills = (ctx: Ctx, paths: FmPaths): Readonly<Record<string, string>> => {
  const log = ctx.runtime.readText(paths.log);
  const last: Record<string, string> = {};
  if (!log.ok) return last;
  for (const line of log.value.split("\n")) {
    if (!line.includes('"restore_drill"')) continue;
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["status"] !== "passed") continue;
    const { store, at } = parsed.value;
    if (typeof store === "string" && typeof at === "string") last[store] = at;
  }
  return last;
};

export const restoreCheckCommand: CommandSpec = {
  path: ["restore", "check"],
  summaryKey: "command.restore_check.summary",
  usage: "finitemonkey restore check",
  status: "ready",
  run: (ctx) =>
    inRepo(ctx, (paths) => {
      const mode = featureMode(ctx.runtime, paths, RESTORE_FEATURE);
      const config = restoreConfig(loadProjectConfig(ctx.runtime, paths.root));
      const reach = mode === "off" ? [] : reachFindings(ctx.runtime, paths.root, config);
      const last = lastPassedDrills(ctx, paths);
      const stale = config.stores
        .filter((store) => mode !== "off" && isStale(last[store.name], nowMs(ctx.runtime), config.periodDays))
        .map((store) => ({ store: store.name, lastPassed: last[store.name] ?? null }));
      const evidence = config.stores.flatMap((store) => {
        const sha256 = store.evidence === undefined ? undefined : evidenceHash(ctx.runtime, paths.root, store.evidence);
        return sha256 === undefined ? [] : [{ store: store.name, sha256 }];
      });
      const lines = [
        ...(config.stores.length === 0 ? [ctx.t("restore.none")] : []),
        ...reach.map((item) => ctx.t(`restore.reach.${item.problem}`, { store: item.store })),
        ...stale.map((item) =>
          ctx.t("restore.stale", { store: item.store, last: item.lastPassed ?? "-", days: config.periodDays }),
        ),
        ...(mode === "shadow" && reach.length > 0 ? [ctx.t("restore.shadow")] : []),
      ];
      const data = { schema: RESTORE_SCHEMA, mode, reach, stale, evidence };
      return mode === "active" && reach.length > 0
        ? failureFrom(ctx.t, restoreProblem(reach.length, data), lines)
        : success(data, lines);
    }),
};

export const restoreDrillCommand: CommandSpec = {
  path: ["restore", "drill"],
  summaryKey: "command.restore_drill.summary",
  usage: "finitemonkey restore drill [<store>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    inRepo(ctx, (paths) => {
      const config = restoreConfig(loadProjectConfig(ctx.runtime, paths.root));
      const wanted = args.positionals[0];
      const stores = config.stores.filter((store) => wanted === undefined || store.name === wanted);
      const results = stores.map((store) => runDrill(ctx.runtime, paths.root, store));
      for (const result of results) {
        if (result.status === "not_configured") continue;
        logEvent(ctx.runtime, paths, "restore_drill", { ...result, counts: { ...result.counts } });
      }
      const lines = [
        ...(results.length === 0 ? [ctx.t("restore.none")] : []),
        ...results.map((result) =>
          ctx.t(`restore.drill.${result.status}`, { store: result.store, detail: result.detail }),
        ),
      ];
      const bad = results.filter((result) => result.status === "failed" || result.status === "refused").length;
      const data = { schema: RESTORE_SCHEMA, drills: results };
      return bad > 0 ? failureFrom(ctx.t, restoreProblem(bad, data), lines) : success(data, lines);
    }),
};
