import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { DEFAULT_DEPLOY_BRANCH, loadDeployConfig } from "../deploy/config.js";
import { DRIFT_FEATURE, driftHosts, type HostDrift, hostDrift, loadDriftConfig } from "../deploy/drift.js";
import { driftBody, driftTitle, type IssueOutcome, reportDrift } from "../deploy/drift-issue.js";
import { expectedCommit } from "../deploy/status.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const DEPLOY_CHECK_SCHEMA = "finitemonkey/deploy-check@1";
const SHORT = 8;

const hostLine = (ctx: Ctx, host: HostDrift, expected: string): string =>
  ctx.t(`deploy.check.host.${host.state}`, {
    alias: host.alias,
    expected: expected.slice(0, SHORT),
    running: host.running.map((revision) => revision.slice(0, SHORT)).join(", ") || "-",
    head: (host.head ?? "-").slice(0, SHORT),
    edits: host.edits.length,
    detail: host.detail ?? "-",
  });

const issueLine = (ctx: Ctx, outcome: IssueOutcome): string =>
  outcome.kind === "failed"
    ? ctx.t("deploy.check.issue.failed", { detail: outcome.detail })
    : ctx.t(`deploy.check.issue.${outcome.kind}`, { number: outcome.number ?? 0 });

const unconfigured = (ctx: Ctx): CommandResult =>
  failureFrom(ctx.t, {
    code: "deploy_check_unconfigured",
    messageKey: "deploy.check.no_host",
    params: {},
    fix: "finitemonkey infra",
    exitCode: ExitCode.NotConfigured,
  });

const runCheck = (ctx: Ctx, root: AbsolutePath, values: OptionValues): CommandResult => {
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, DRIFT_FEATURE);
  if (mode === "off") return success({ schema: DEPLOY_CHECK_SCHEMA, mode }, [ctx.t("deploy.check.off")]);
  const hosts = driftHosts(ctx.runtime, root, ctx.env);
  if (hosts.length === 0) return unconfigured(ctx);
  const branch = loadDeployConfig(ctx.runtime, root)?.branch ?? DEFAULT_DEPLOY_BRANCH;
  const expected = expectedCommit(ctx.runtime, root, branch) ?? "";
  const config = loadDriftConfig(ctx.runtime, root);
  const results = hosts.map((host) => hostDrift(ctx.runtime, root, host, config, expected));
  const diverged = results.filter((host) => host.state === "diverged");
  logEvent(ctx.runtime, paths, "deploy.drift", { hosts: results.length, diverged: diverged.length, mode });
  const issue =
    diverged.length > 0 && values["issue"] === true
      ? reportDrift(ctx.runtime, root, driftTitle(branch), driftBody(branch, expected, results, ctx.runtime.now()))
      : undefined;
  const data = { schema: DEPLOY_CHECK_SCHEMA, mode, branch, expected, hosts: results, issue: issue ?? null };
  const human = [
    ...results.map((host) => hostLine(ctx, host, expected)),
    ...(issue === undefined ? [] : [issueLine(ctx, issue)]),
  ];
  if (diverged.length === 0 || mode === "shadow") return success(data, human);
  return failureFrom(
    ctx.t,
    {
      code: "deploy_drift_found",
      messageKey: "deploy.check.diverged",
      params: { count: diverged.length, branch },
      fix: "redeploy from the branch; do not edit the server by hand",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

export const deployCheckCommand: CommandSpec = {
  path: ["deploy", "check"],
  summaryKey: "command.deploy_check.summary",
  usage: "finitemonkey deploy check [--issue]",
  status: "ready",
  maxPositionals: 0,
  options: { issue: { type: "boolean" } },
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    return Promise.resolve(
      repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : runCheck(ctx, repo.root, args.values),
    );
  },
};
