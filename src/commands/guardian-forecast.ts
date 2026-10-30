import { success } from "../core/result.js";
import { forecastFor } from "../guardian/forecast.js";
import { forecastLine } from "../guardian/forecast-hook.js";
import { activeTask, knownTasks } from "../guardian/tasks.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const GUARDIAN_FORECAST_SCHEMA = "finitemonkey/guardian-forecast@1";

export const guardianForecastCommand: CommandSpec = {
  path: ["guardian", "forecast"],
  summaryKey: "command.guardian_forecast.summary",
  usage: "finitemonkey guardian forecast [<task>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const tasks = knownTasks(ctx.runtime, paths);
      const wanted = args.positionals[0] ?? activeTask(ctx.runtime, paths)?.contract.id;
      const task = tasks.find((item) => item.contract.id === wanted);
      const forecast = task === undefined ? undefined : forecastFor(ctx.runtime, paths, tasks, task.contract);
      return success({ schema: GUARDIAN_FORECAST_SCHEMA, task: wanted ?? null, forecast: forecast ?? null }, [
        forecast === undefined ? ctx.t("guardian.forecast.none") : forecastLine(ctx.t, forecast),
      ]);
    }),
};
