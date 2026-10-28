import { join } from "node:path";

import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom } from "../core/result.js";
import { defaultOn } from "../defaults/items.js";
import { LINT_PRESETS, type LintPreset } from "../generate/lint/config.js";
import { lintPlan } from "../generate/lint/plan.js";
import { runGenerator } from "../generate/run.js";
import { detectStack } from "../generate/stack.js";
import { projectRoot } from "../secrets/project.js";
import type { CommandSpec } from "./types.js";

export const LINT_GEN_FEATURE = "lint-gen";

const LINT_USAGE = "finitemonkey gen lint [--preset no-comments,architecture,strict] [--dry-run] [--yes]";

const reader =
  (ctx: Ctx) =>
  (path: string): string | undefined => {
    const text = ctx.runtime.readText(toAbsolutePath(join(projectRoot(ctx), ...path.split("/"))));
    return text.ok ? text.value : undefined;
  };

const presetsFrom = (ctx: Ctx, raw: string | undefined): ReadonlySet<LintPreset> | undefined => {
  if (raw === undefined) {
    const comments = defaultOn(ctx.runtime, projectRoot(ctx), "no-comments");
    return new Set(LINT_PRESETS.filter((preset) => preset !== "no-comments" || comments));
  }
  const asked = raw.split(",").map((item) => item.trim());
  const known = LINT_PRESETS.filter((preset) => asked.includes(preset));
  return known.length === asked.length ? new Set(known) : undefined;
};

export const genLintCommand: CommandSpec = {
  path: ["gen", "lint"],
  summaryKey: "gen.command.lint",
  usage: LINT_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { preset: { type: "string" } },
  run: (ctx, args) => {
    const raw = stringOption(args.values, "preset");
    const presets = presetsFrom(ctx, raw);
    if (presets === undefined)
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "error.invalid_arguments", LINT_USAGE, { detail: raw ?? "" }),
        ),
      );
    const plan = lintPlan(ctx.t, detectStack(ctx.runtime, projectRoot(ctx)), presets, reader(ctx));
    const preset = raw === undefined ? "" : ` --preset ${[...presets].join(",")}`;
    return Promise.resolve(
      runGenerator(ctx, {
        generator: "lint",
        feature: LINT_GEN_FEATURE,
        files: plan.files,
        notes: plan.notes,
        rerun: `finitemonkey gen lint${preset} --yes`,
      }),
    );
  },
};
