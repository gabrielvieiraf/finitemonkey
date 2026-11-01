import { localSend } from "../app/node-probe.js";
import { portOpen, type RunningApp, startApp, stopApp, waitForPort } from "../app/node-process.js";
import { nowMs } from "../core/clock.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { migrateConfig } from "../db/throwaway.js";
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
import { ownedTables, type RowFinding, rowFindings, rowsConfig, type RowsRun, scanTables } from "../scenarios/rows.js";
import { runRowScenarios } from "../scenarios/rows-sql.js";
import { localUrl, runScenarios, type ScenarioResult } from "../scenarios/run.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

const START_TIMEOUT_MS = 60_000;
const ROWS_BUDGET_MS = 300_000;
const CONFIG_HINT =
  "add access: start, port, user_a and user_b (a header line such as authorization: Bearer <token>) to .finitemonkey/config.yml";

export const sentence = (ctx: Pick<Ctx, "t">, item: Pick<Scenario, "kind" | "resource"> | ScenarioResult): string =>
  item.kind === "setup"
    ? ctx.t("scenarios.says.setup", { resource: item.resource })
    : ctx.t(`scenarios.says.${item.kind}`, { resource: item.resource });

interface Located {
  readonly root: Parameters<typeof scanRoutes>[1];
  readonly routes: ReturnType<typeof scanRoutes>;
  readonly resources: readonly Resource[];
}

const located = (ctx: Ctx): Located | undefined => {
  const repo = repoOf(ctx);
  if (repo === undefined) return undefined;
  const routes = scanRoutes(ctx.runtime, repo.root);
  return { root: repo.root, routes, resources: resourcesOf(routes) };
};

const policyLine = (ctx: Ctx, finding: RowFinding): string =>
  `  ${ctx.t(`scenarios.rows.${finding.kind}`, { table: finding.table, policy: finding.policy ?? "" })}`;

const findingsAt = (ctx: Ctx, root: Located["root"]): readonly RowFinding[] => {
  const config = rowsConfig(loadProjectConfig(ctx.runtime, root));
  return rowFindings(ownedTables(scanTables(ctx.runtime, root, config), config));
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
  const policies = findingsAt(ctx, found.root);
  return success({ schema: SCENARIOS_SCHEMA, resources: found.resources, scenarios, routes: found.routes, policies }, [
    ...(scenarios.length === 0 ? [ctx.t("scenarios.none")] : []),
    ...scenarios.map((scenario) => `  ${sentence(ctx, scenario)}`),
    ...policies.map((finding) => policyLine(ctx, finding)),
  ]);
};

const rowsData = (rows: RowsRun) => ({
  state: rows.kind,
  results: rows.kind === "ran" ? rows.results : [],
  ...(rows.kind === "unavailable" ? { step: rows.step, detail: rows.detail } : {}),
});

const rowLines = (ctx: Ctx, rows: RowsRun): readonly string[] => {
  if (rows.kind === "ran")
    return rows.results.map((item) =>
      ctx.t(item.passed ? "scenarios.rows.passed" : "scenarios.rows.failed", {
        says: ctx.t(`scenarios.rows.says.${item.kind}`, { table: item.table }),
        count: item.count,
      }),
    );
  if (rows.kind === "unavailable")
    return [ctx.t("scenarios.rows.unavailable", { step: rows.step, detail: rows.detail })];
  return rows.kind === "refused" ? [ctx.t("scenarios.rows.refused")] : [];
};

const httpRun = async (found: Located, config: AccessConfig | undefined) => {
  if (config === undefined || found.resources.length === 0) return { state: "none" as const, results: [] };
  const outcome = await withApp(config, found.root, () =>
    runScenarios(
      found.resources,
      config,
      localSend((path) => localUrl(config.port, path)),
    ),
  );
  return "failed" in outcome
    ? { state: "failed" as const, app: outcome.failed, results: [] }
    : { state: "ran" as const, results: outcome.value };
};

const runAll = async (ctx: Ctx): Promise<CommandResult> => {
  const found = located(ctx);
  if (found === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const tree = loadProjectConfig(ctx.runtime, found.root);
  const config = accessConfig(tree);
  const rows =
    migrateConfig(tree).url === undefined
      ? ({ kind: "none" } as const)
      : runRowScenarios(ctx.runtime, found.root, nowMs(ctx.runtime) + ROWS_BUDGET_MS);
  if (config === undefined && rows.kind === "none")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "scenarios.not_configured", CONFIG_HINT));
  if (found.resources.length === 0 && rows.kind === "none")
    return success({ schema: SCENARIOS_SCHEMA, ran: false, results: [], rows: rowsData(rows) }, [
      ctx.t("scenarios.none"),
    ]);
  const http = await httpRun(found, config);
  const ran = http.state !== "failed" && (http.state === "ran" || rows.kind === "ran");
  const data = { schema: SCENARIOS_SCHEMA, ran, results: http.results, rows: rowsData(rows) };
  if (http.state === "failed")
    return success({ ...data, app: http.app }, [
      ctx.t("scenarios.app_failed", { state: http.app, port: config?.port ?? 0 }),
      ...rowLines(ctx, rows),
    ]);
  return success(data, [
    ...http.results.map((item: ScenarioResult) =>
      ctx.t(item.passed ? "scenarios.passed" : "scenarios.failed", {
        says: sentence(ctx, item),
        status: item.status ?? "-",
      }),
    ),
    ...rowLines(ctx, rows),
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
