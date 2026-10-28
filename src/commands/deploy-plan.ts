import { stringOption } from "../core/args.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { DEFAULT_DEPLOY_BRANCH, loadDeployConfig } from "../deploy/config.js";
import { recordLevel } from "../deploy/level.js";
import { changedMigrations, deployBase, lintChangedMigrations } from "../deploy/migrations.js";
import { buildPlan, type DeployPlan, PLAN_PARTS } from "../deploy/plan.js";
import { gitAt } from "../gate/git.js";
import { type LevelRecord, readEvidence, readHosts, readLevel } from "../infra/file.js";
import { scanInfra } from "../infra/scan.js";
import { type DeployLevel, type Inventory, isDeployLevel } from "../infra/types.js";
import { featureMode } from "../policy/feature.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const DEPLOY_PLAN_SCHEMA = "finitemonkey/deploy-plan@1";
export const DEPLOY_PLAN_FEATURE = "deploy-plan";

const LEVEL_NAMES = ["level0", "level1", "level2", "level3"] as const;

const effectiveLevel = (recorded: LevelRecord | undefined, inventory: Inventory): LevelRecord =>
  recorded?.source === "confirmed" ? recorded : { level: inventory.level, source: "detected" };

const planLines = (ctx: Ctx, plan: DeployPlan, level: LevelRecord): readonly string[] => [
  ctx.t("deploy.plan.title", { level: plan.level, source: level.source }),
  ...PLAN_PARTS.map((part) => ctx.t(`deploy.plan.${LEVEL_NAMES[plan.level]}.${part}`)),
  ...plan.items.map((item) =>
    ctx.t(item.ok ? "deploy.plan.item.ok" : "deploy.plan.item.missing", {
      item: ctx.t(`deploy.plan.check.${item.id}`),
      check: item.check,
    }),
  ),
  ...plan.migrations.map((issue) =>
    ctx.t(`deploy.plan.migration.${issue.kind}`, { at: `${issue.file}:${String(issue.line)}` }),
  ),
];

const confirmLine = (ctx: Ctx, level: LevelRecord): readonly string[] =>
  level.source === "confirmed" ? [] : [ctx.t("deploy.plan.confirm", { level: level.level })];

const showPlan = (ctx: Ctx, root: AbsolutePath): CommandResult => {
  const inventory = scanInfra(ctx.runtime, root, readHosts(ctx.runtime, root));
  const level = effectiveLevel(readLevel(ctx.runtime, root), inventory);
  const git = gitAt(ctx.runtime, root);
  const branch = loadDeployConfig(ctx.runtime, root)?.branch ?? DEFAULT_DEPLOY_BRANCH;
  const files = level.level === 0 ? [] : changedMigrations(git, deployBase(git, branch));
  const plan = buildPlan(
    level.level,
    inventory,
    lintChangedMigrations(ctx.runtime, root, files),
    readEvidence(ctx.runtime, root),
  );
  const data = {
    schema: DEPLOY_PLAN_SCHEMA,
    level: plan.level,
    levelSource: level.source,
    detectedLevel: inventory.level,
    items: plan.items,
    migrations: plan.migrations,
  };
  const result = success(data, [...planLines(ctx, plan, level), ...confirmLine(ctx, level)]);
  return level.source === "confirmed"
    ? result
    : { ...result, next: `finitemonkey deploy plan --level ${String(level.level)} --yes` };
};

const parseLevel = (raw: string | undefined): DeployLevel | "invalid" | undefined => {
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return isDeployLevel(value) && String(value) === raw.trim() ? value : "invalid";
};

const record = (ctx: Ctx, root: AbsolutePath, values: OptionValues): CommandResult | undefined => {
  const level = parseLevel(stringOption(values, "level"));
  const evidence = stringOption(values, "rollback-evidence");
  if (level === undefined && evidence === undefined) return undefined;
  if (level === "invalid")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "deploy.plan.bad_level", "finitemonkey deploy plan --level 1 --yes"),
    );
  if (!(ctx.yes && isPerson(ctx)))
    return failureFrom(
      ctx.t,
      needsPersonProblem("deploy.plan.needs_person", "finitemonkey deploy plan --level <0-3> --yes"),
    );
  const outcome = recordLevel(ctx.runtime, root, {
    level,
    evidence,
    decision: stringOption(values, "decision"),
  });
  return outcome.ok ? undefined : failureFrom(ctx.t, outcome.problem);
};

const runPlan = (ctx: Ctx, root: AbsolutePath, values: OptionValues): CommandResult => {
  const mode = featureMode(ctx.runtime, fmPaths(root), DEPLOY_PLAN_FEATURE);
  if (mode === "off") return success({ schema: DEPLOY_PLAN_SCHEMA, mode }, [ctx.t("deploy.plan.off")]);
  const recorded = record(ctx, root, values);
  if (recorded !== undefined) return recorded;
  return showPlan(ctx, root);
};

export const deployPlanCommand: CommandSpec = {
  path: ["deploy", "plan"],
  summaryKey: "command.deploy_plan.summary",
  usage: "finitemonkey deploy plan [--level <0-3> [--decision <docs/plan file>]] [--rollback-evidence <url>] [--yes]",
  status: "ready",
  maxPositionals: 0,
  options: { level: { type: "string" }, decision: { type: "string" }, "rollback-evidence": { type: "string" } },
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    return Promise.resolve(
      repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : runPlan(ctx, repo.root, args.values),
    );
  },
};
