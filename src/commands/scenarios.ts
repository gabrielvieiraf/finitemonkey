import { localSend } from "../app/node-probe.js";
import { portOpen, type RunningApp, startApp, stopApp, waitForPort } from "../app/node-process.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { loadProjectConfig } from "../git/project-config.js";
import {
  type AccessConfig,
  accessConfig,
  LOCALHOST,
  type Resource,
  resourcesOf,
  scanRoutes,
  type Scenario,
  SCENARIOS_SCHEMA,
  scenariosFor,
} from "../scenarios/plan.js";
import { localUrl, runScenarios, type ScenarioResult } from "../scenarios/run.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

const START_TIMEOUT_MS = 60_000;
const CONFIG_HINT =
  "add access: start, port, user_a and user_b (a header line such as authorization: Bearer <token>) to .finitemonkey/config.yml";

export const sentence = (ctx: Pick<Ctx, "t">, item: Pick<Scenario, "kind" | "resource"> | ScenarioResult): string =>
  item.kind === "setup"
    ? ctx.t("scenarios.says.setup", { resource: item.resource })
    : ctx.t(`scenarios.says.${item.kind}`, { resource: item.resource });

const located = (
  ctx: Ctx,
): { readonly root: Parameters<typeof scanRoutes>[1]; readonly resources: readonly Resource[] } | undefined => {
  const repo = repoOf(ctx);
  if (repo === undefined) return undefined;
  return { root: repo.root, resources: resourcesOf(scanRoutes(ctx.runtime, repo.root)) };
};

const withApp = async <T>(
  config: AccessConfig,
  root: string,
  work: () => Promise<T>,
): Promise<{ readonly value: T } | { readonly failed: string }> => {
  if (await portOpen(LOCALHOST, config.port)) return { value: await work() };
  if (config.start === undefined) return { failed: "no_start" };
  const app: RunningApp = startApp(config.start, root, config.port);
  try {
    const state = await waitForPort(app, LOCALHOST, config.port, Date.now() + START_TIMEOUT_MS);
    return state === "open" ? { value: await work() } : { failed: state };
  } finally {
    await stopApp(app);
  }
};

const listScenarios = (ctx: Ctx): CommandResult => {
  const found = located(ctx);
  if (found === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const scenarios = found.resources.flatMap(scenariosFor);
  return success({ schema: SCENARIOS_SCHEMA, resources: found.resources, scenarios }, [
    ...(scenarios.length === 0 ? [ctx.t("scenarios.none")] : []),
    ...scenarios.map((scenario) => `  ${sentence(ctx, scenario)}`),
  ]);
};

const runAll = async (ctx: Ctx): Promise<CommandResult> => {
  const found = located(ctx);
  if (found === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const config = accessConfig(loadProjectConfig(ctx.runtime, found.root));
  if (config === undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "scenarios.not_configured", CONFIG_HINT));
  if (found.resources.length === 0)
    return success({ schema: SCENARIOS_SCHEMA, ran: false, results: [] }, [ctx.t("scenarios.none")]);
  const outcome = await withApp(config, found.root, () =>
    runScenarios(
      found.resources,
      config,
      localSend((path) => localUrl(config.port, path)),
    ),
  );
  if ("failed" in outcome)
    return success({ schema: SCENARIOS_SCHEMA, ran: false, app: outcome.failed, results: [] }, [
      ctx.t("scenarios.app_failed", { state: outcome.failed, port: config.port }),
    ]);
  const results = outcome.value;
  return success({ schema: SCENARIOS_SCHEMA, ran: true, results }, [
    ...results.map((item) =>
      ctx.t(item.passed ? "scenarios.passed" : "scenarios.failed", {
        says: sentence(ctx, item),
        status: item.status ?? "-",
      }),
    ),
  ]);
};

export const scenariosCommand: CommandSpec = {
  path: ["scenarios"],
  summaryKey: "command.scenarios.summary",
  usage: "finitemonkey scenarios [--json]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(listScenarios(ctx)),
};

export const scenariosRunCommand: CommandSpec = {
  path: ["scenarios", "run"],
  summaryKey: "command.scenarios_run.summary",
  usage: "finitemonkey scenarios run [--json]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => runAll(ctx),
};
