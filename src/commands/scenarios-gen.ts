import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { loadProjectConfig } from "../git/project-config.js";
import { approveTwoTenant, proposalPath, proposeTwoTenant, testPath, twoTenantTest } from "../scenarios/gen.js";
import { accessConfig, resourcesOf, scanRoutes, SCENARIOS_SCHEMA } from "../scenarios/plan.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import { scenariosCommand, scenariosRunCommand } from "./scenarios.js";
import type { CommandSpec } from "./types.js";

const GEN_USAGE = "finitemonkey scenarios gen [--json]";
const APPROVE_USAGE = "finitemonkey scenarios approve --hash <hash>";
const CONFIG_HINT = "add access: port, user_a and user_b to .fm/config.yml";

const generate = (ctx: Ctx): CommandResult => {
  const repo = repoOf(ctx);
  if (repo === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const config = accessConfig(loadProjectConfig(ctx.runtime, repo.root));
  if (config === undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "scenarios.not_configured", CONFIG_HINT));
  const resources = resourcesOf(scanRoutes(ctx.runtime, repo.root));
  if (resources.length === 0)
    return success({ schema: SCENARIOS_SCHEMA, generated: false, resources: [] }, [ctx.t("scenarios.none")]);
  const paths = fmPaths(repo.root);
  const made = proposeTwoTenant(ctx.runtime, paths, twoTenantTest(resources, config));
  if (!made.ok) return failureFrom(ctx.t, usageProblem("invalid_arguments", "scenarios.gen.write", GEN_USAGE));
  logEvent(ctx.runtime, paths, "scenarios.test_proposed", { hash: made.value, resources: resources.length });
  return {
    ...success(
      { schema: SCENARIOS_SCHEMA, generated: true, hash: made.value, proposal: proposalPath(paths), resources },
      [ctx.t("scenarios.gen.proposed", { path: proposalPath(paths), hash: made.value })],
    ),
    next: `fm scenarios approve --hash ${made.value}`,
  };
};

const approve = (ctx: Ctx, hash: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("scenarios.gen.person_only", APPROVE_USAGE));
  const repo = repoOf(ctx);
  if (repo === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const paths = fmPaths(repo.root);
  const target = testPath(loadProjectConfig(ctx.runtime, repo.root), repo.root);
  const done = approveTwoTenant(ctx.runtime, paths, target, hash);
  if (!done.ok)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", `scenarios.gen.${done.error}`, APPROVE_USAGE));
  logEvent(ctx.runtime, paths, "scenarios.test_approved", { hash: done.value });
  return success({ schema: SCENARIOS_SCHEMA, approved: true, hash: done.value, path: target }, [
    ctx.t("scenarios.gen.approved", { path: target, hash: done.value }),
  ]);
};

export const scenariosGenCommand: CommandSpec = {
  path: ["scenarios", "gen"],
  summaryKey: "command.scenarios_gen.summary",
  usage: GEN_USAGE,
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(generate(ctx)),
};

export const scenariosApproveCommand: CommandSpec = {
  path: ["scenarios", "approve"],
  summaryKey: "command.scenarios_approve.summary",
  usage: APPROVE_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { hash: { type: "string" } },
  run: (ctx, args) => Promise.resolve(approve(ctx, stringOption(args.values, "hash"))),
};

export const SCENARIO_COMMANDS: readonly CommandSpec[] = [
  scenariosCommand,
  scenariosRunCommand,
  scenariosGenCommand,
  scenariosApproveCommand,
];
