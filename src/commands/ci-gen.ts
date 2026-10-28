import { CI_WORKFLOWS, ciFiles, type CiWorkflow, DEFAULT_WORKFLOWS } from "../ci/gen/plan.js";
import { REVIEW_TRIGGER } from "../ci/gen/workflows.js";
import { projectLevel } from "../ci/level.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom } from "../core/result.js";
import { projectDefaults } from "../defaults/items.js";
import { runGenerator } from "../generate/run.js";
import { detectStack } from "../generate/stack.js";
import { repoFacts } from "../git/repo.js";
import { projectAt } from "../install/project.js";
import { projectRoot } from "../secrets/project.js";
import { projectFiles } from "../supply/files.js";
import { repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const CI_GEN_FEATURE = "ci-gen";

const USAGE = "finitemonkey ci gen [--with deploy,release,review] [--oidc] [--dry-run] [--yes]";

const chosenFrom = (raw: string | undefined): ReadonlySet<CiWorkflow> | undefined => {
  const asked = raw === undefined ? [] : raw.split(",").map((item) => item.trim());
  const known = CI_WORKFLOWS.filter((name) => asked.includes(name));
  return known.length === asked.length ? new Set([...DEFAULT_WORKFLOWS, ...known]) : undefined;
};

const notesFor = (ctx: Ctx, chosen: ReadonlySet<CiWorkflow>, deployScript: boolean): readonly string[] => {
  const level = projectLevel(ctx.runtime, projectRoot(ctx));
  return [
    ...(chosen.has("deploy") && !deployScript ? [ctx.t("ci.gen.deploy_command")] : []),
    ...(chosen.has("deploy") && level >= 2 ? [ctx.t("ci.gen.reviewers", { level })] : []),
    ...(chosen.has("release") ? [ctx.t("ci.gen.release")] : []),
    ...(chosen.has("review") ? [ctx.t("ci.gen.review", { trigger: REVIEW_TRIGGER })] : []),
  ];
};

export const ciGenCommand: CommandSpec = {
  path: ["ci", "gen"],
  summaryKey: "ci.command.gen",
  usage: USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { with: { type: "string" }, oidc: { type: "boolean" } },
  run: (ctx, args) => {
    const raw = stringOption(args.values, "with");
    const chosen = chosenFrom(raw);
    if (chosen === undefined)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: raw ?? "" })),
      );
    const root = projectRoot(ctx);
    const project = projectAt(root, ctx.runtime);
    const repo = repoOf(ctx);
    const oidc = args.values["oidc"] === true;
    const files = ciFiles(
      {
        runtime: ctx.runtime,
        root,
        stack: detectStack(ctx.runtime, root),
        files: projectFiles(ctx.runtime, root),
        exists: project.exists,
        read: project.read,
        defaults: projectDefaults(ctx.runtime, root),
        version: ctx.version,
        defaultBranch: repo === undefined ? "main" : repoFacts(ctx.runtime, repo).defaultBranch(),
        oidc,
      },
      chosen,
    );
    const extra = [...chosen].filter((name) => !DEFAULT_WORKFLOWS.includes(name));
    const flags = `${extra.length === 0 ? "" : ` --with ${extra.join(",")}`}${oidc ? " --oidc" : ""}`;
    return Promise.resolve(
      runGenerator(ctx, {
        generator: "ci",
        feature: CI_GEN_FEATURE,
        files,
        notes: notesFor(ctx, chosen, project.exists("scripts/deploy.sh") || project.exists("deploy.sh")),
        rerun: `finitemonkey ci gen${flags} --yes`,
      }),
    );
  },
};
