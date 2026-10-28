import { stringOption } from "../core/args.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { DEFAULT_DEPLOY_BRANCH, loadDeployConfig } from "../deploy/config.js";
import { type GenerateBlock, planGenerate, projectFiles } from "../deploy/generate.js";
import { ExitCode } from "../exit-codes.js";
import { readHosts, readLevel } from "../infra/file.js";
import { planFiles, type PlannedFile, projectFormat, writePlanned } from "../infra/plan-files.js";
import { scanInfra } from "../infra/scan.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const DEPLOY_GENERATE_SCHEMA = "finitemonkey/deploy-generate@1";
export const DEPLOY_GENERATE_FEATURE = "deploy-generate";
const DEFAULT_PORT = 3000;
const DEFAULT_HEALTH = "/health";

const blocked = (block: GenerateBlock, level: number): Problem => ({
  code: "deploy_generate_blocked",
  messageKey: `deploy.generate.blocked.${block}`,
  params: { level },
  fix:
    block === "level"
      ? "finitemonkey deploy plan"
      : block === "no_dockerfile"
        ? "add a Dockerfile with a non-root USER"
        : 'finitemonkey deploy generate --check "<command that proves the build is good>"',
  exitCode: ExitCode.CheckFailed,
});

const fileLines = (ctx: Ctx, planned: readonly PlannedFile[]): readonly string[] =>
  planned.flatMap((file) => [
    ctx.t(`deploy.generate.file.${file.action}`, { file: file.path }),
    ...(file.action === "unchanged" ? [] : file.diff.map((line) => `    ${line}`)),
  ]);

const options = (ctx: Ctx, root: AbsolutePath, values: OptionValues) => {
  const port = Number.parseInt(stringOption(values, "port") ?? "", 10);
  const health = stringOption(values, "health") ?? DEFAULT_HEALTH;
  return {
    branch: loadDeployConfig(ctx.runtime, root)?.branch ?? DEFAULT_DEPLOY_BRANCH,
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    health: health.startsWith("/") ? health : `/${health}`,
    check: stringOption(values, "check"),
  };
};

const runGenerate = (ctx: Ctx, root: AbsolutePath, values: OptionValues): CommandResult => {
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, DEPLOY_GENERATE_FEATURE);
  if (mode === "off") return success({ schema: DEPLOY_GENERATE_SCHEMA, mode }, [ctx.t("deploy.generate.off")]);
  const inventory = scanInfra(ctx.runtime, root, readHosts(ctx.runtime, root));
  const recorded = readLevel(ctx.runtime, root);
  const level = recorded?.source === "confirmed" ? recorded.level : inventory.level;
  const plan = planGenerate(projectFiles(ctx.runtime, root), level, inventory, options(ctx, root, values));
  if (!plan.ok) return failureFrom(ctx.t, blocked(plan.block, level));
  const format = projectFormat(ctx.runtime, root);
  const planned = planFiles(
    ctx.runtime,
    root,
    plan.files.map((file) => ({ ...file, text: format(file.path, file.text) })),
  );
  const creates = planned.filter((file) => file.action === "create").length;
  const apply = ctx.yes && !ctx.dryRun && mode === "active" && creates > 0;
  if (ctx.yes && mode === "shadow") recordFeatureShadow(ctx.runtime, paths, DEPLOY_GENERATE_FEATURE, { creates });
  const written = apply ? writePlanned(ctx.runtime, root, planned, false).written : [];
  const data = {
    schema: DEPLOY_GENERATE_SCHEMA,
    level,
    checks: plan.checks,
    files: planned.map((file) => ({ path: file.path, action: file.action })),
    written,
  };
  const human = [
    ctx.t("deploy.generate.title"),
    ...fileLines(ctx, planned),
    ...(planned.some((file) => file.action === "differs") ? [ctx.t("deploy.generate.kept")] : []),
    ctx.t(
      written.length > 0
        ? "deploy.generate.written"
        : creates > 0
          ? "deploy.generate.preview"
          : "deploy.generate.nothing",
      {
        count: written.length,
      },
    ),
    ...(written.length > 0 ? [ctx.t("deploy.generate.setup")] : []),
  ];
  const result = success(data, human);
  return creates > 0 && !apply ? { ...result, next: "finitemonkey deploy generate --yes" } : result;
};

export const deployGenerateCommand: CommandSpec = {
  path: ["deploy", "generate"],
  summaryKey: "command.deploy_generate.summary",
  usage: "finitemonkey deploy generate [--port <n>] [--health <route>] [--check <command>] [--dry-run] [--yes]",
  status: "ready",
  maxPositionals: 0,
  options: { port: { type: "string" }, health: { type: "string" }, check: { type: "string" } },
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    return Promise.resolve(
      repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : runGenerate(ctx, repo.root, args.values),
    );
  },
};
