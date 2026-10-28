import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom } from "../core/result.js";
import { invalidCodeownersLines } from "../doctor/github.js";
import { codeownersFile, ownerFromRemote } from "../generate/github/codeowners.js";
import { prTemplateFile } from "../generate/github/pr-template.js";
import { runGenerator } from "../generate/run.js";
import { detectStack } from "../generate/stack.js";
import { projectAt } from "../install/project.js";
import { projectRoot } from "../secrets/project.js";
import type { CommandSpec } from "./types.js";

export const PR_GEN_FEATURE = "pr-gen";

const projectOf = (ctx: Ctx) => projectAt(projectRoot(ctx), ctx.runtime);

export const genPrTemplateCommand: CommandSpec = {
  path: ["gen", "pr-template"],
  summaryKey: "gen.command.pr_template",
  usage: "finitemonkey gen pr-template [--dry-run] [--yes]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const project = projectOf(ctx);
    return Promise.resolve(
      runGenerator(ctx, {
        generator: "pr-template",
        feature: PR_GEN_FEATURE,
        files: [prTemplateFile(ctx.lang, project.exists)],
        notes: [],
        rerun: "finitemonkey gen pr-template --yes",
      }),
    );
  },
};

interface Owner {
  readonly owner: string;
  readonly notes: readonly string[];
}

const CODEOWNERS_USAGE = "finitemonkey gen codeowners [--owner <@user|@org/team>] [--dry-run] [--yes]";

const ownerOf = (ctx: Ctx, given: string | undefined): Owner | undefined => {
  if (given !== undefined && given !== "") return { owner: given, notes: [] };
  const remote = ctx.runtime.git(["remote", "get-url", "origin"], projectRoot(ctx));
  const owner = remote.ok ? ownerFromRemote(remote.stdout) : undefined;
  return owner === undefined ? undefined : { owner, notes: [ctx.t("gen.codeowners.inferred", { owner })] };
};

export const genCodeownersCommand: CommandSpec = {
  path: ["gen", "codeowners"],
  summaryKey: "gen.command.codeowners",
  usage: CODEOWNERS_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { owner: { type: "string" } },
  run: (ctx, args) => {
    const project = projectOf(ctx);
    const found = ownerOf(ctx, stringOption(args.values, "owner"));
    if (found === undefined)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "gen.codeowners.no_owner", CODEOWNERS_USAGE)),
      );
    const { owner, notes } = found;
    const stack = detectStack(ctx.runtime, project.root);
    const file = codeownersFile({ owner, dirs: stack.dirs, exists: project.exists });
    if (invalidCodeownersLines(file.text).length > 0)
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "error.invalid_arguments", CODEOWNERS_USAGE, { detail: owner }),
        ),
      );
    return Promise.resolve(
      runGenerator(ctx, {
        generator: "codeowners",
        feature: PR_GEN_FEATURE,
        files: [file],
        notes,
        rerun: `finitemonkey gen codeowners --owner ${owner} --yes`,
      }),
    );
  },
};
