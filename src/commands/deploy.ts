import type { Ctx } from "../core/context.js";
import { type CommandResult, success } from "../core/result.js";
import { loadDeployConfig } from "../deploy/config.js";
import { deployLine, saveReport, whatToTest } from "../deploy/report.js";
import { checkDeploy, type DeployVerdict, expectedCommit, waitForDeploy } from "../deploy/status.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const DEPLOY_SCHEMA = "finitemonkey/deploy-status@1";

const verdictData = (verdict: DeployVerdict, test: string | undefined): Readonly<Record<string, unknown>> => ({
  schema: DEPLOY_SCHEMA,
  configured: true,
  state: verdict.state,
  expected: verdict.expected,
  live: verdict.live ?? null,
  url: verdict.url ?? null,
  run: verdict.run ?? null,
  detail: verdict.detail ?? null,
  test: test ?? null,
});

const deployStatus = async (ctx: Ctx, values: OptionValues): Promise<CommandResult> => {
  const root = findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd;
  const config = loadDeployConfig(ctx.runtime, root);
  if (config === undefined) {
    return success({ schema: DEPLOY_SCHEMA, configured: false }, [ctx.t("deploy.not_configured")]);
  }
  const expected = expectedCommit(ctx.runtime, root, config.branch);
  if (expected === undefined) {
    return success({ schema: DEPLOY_SCHEMA, configured: true, state: "unknown" }, [ctx.t("deploy.no_commit")]);
  }
  const verdict =
    values["wait"] === true
      ? await waitForDeploy(ctx.runtime, root, config, expected)
      : checkDeploy(ctx.runtime, root, config, expected);
  const paths = fmPaths(root);
  const test = whatToTest(ctx.runtime, paths);
  const line = deployLine(ctx.t, verdict, test);
  if (values["report"] === true) {
    saveReport(ctx.runtime, paths, verdict, line);
    logEvent(ctx.runtime, paths, "deploy.reported", { state: verdict.state, expected: verdict.expected });
  }
  return success(verdictData(verdict, test), [line]);
};

export const deployStatusCommand: CommandSpec = {
  path: ["deploy", "status"],
  summaryKey: "command.deploy_status.summary",
  usage: "finitemonkey deploy status [--wait] [--report]",
  status: "ready",
  options: { wait: { type: "boolean" }, report: { type: "boolean" } },
  run: (ctx, args) => deployStatus(ctx, args.values),
};
