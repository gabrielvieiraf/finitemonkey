import { join } from "node:path";

import { loadArch } from "../arch/config.js";
import { importLinter } from "../arch/generate-other.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom } from "../core/result.js";
import type { GeneratedFile } from "../generate/plan.js";
import { featureMode } from "../policy/feature.js";
import { detectPython, PYTHON_FEATURE, type PythonProject } from "../python/detect.js";
import { DEV_TOOLS, NO_COMMENTS_SCRIPT, PYTEST_INI, pythonCi, RUFF_TOML } from "../python/templates.js";
import { projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { GENERATE_OPTIONS, generateResult } from "./generate-run.js";
import type { CommandSpec, OptionValue } from "./types.js";

export const PRESET_SCHEMA = "finitemonkey/preset@1";
const USAGE = "finitemonkey preset python [--write] [--overwrite]";

const presetFiles = (project: PythonProject, linter: GeneratedFile | undefined): readonly GeneratedFile[] => [
  ...([...project.sections].some((name) => name.startsWith("ruff")) ? [] : [{ path: "ruff.toml", content: RUFF_TOML }]),
  ...(project.sections.has("pytest.ini_options") ? [] : [{ path: "pytest.ini", content: PYTEST_INI }]),
  { path: "scripts/check_no_comments.py", content: NO_COMMENTS_SCRIPT },
  ...(linter === undefined ? [] : [linter]),
  { path: ".github/workflows/ci.yml", content: pythonCi(linter !== undefined) },
];

const python = (ctx: Ctx, values: Readonly<Record<string, OptionValue>>): CommandResult => {
  const root = projectRoot(ctx);
  if (featureMode(ctx.runtime, fmPaths(root), PYTHON_FEATURE) === "off")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "preset.off", USAGE));
  const project = detectPython(
    (relative) => {
      const text = ctx.runtime.readText(toAbsolutePath(join(root, relative)));
      return text.ok ? text.value : undefined;
    },
    (relative) => ctx.runtime.stat(toAbsolutePath(join(root, relative))) !== undefined,
  );
  if (project === undefined) return failureFrom(ctx.t, usageProblem("invalid_arguments", "preset.not_python", USAGE));
  const arch = loadArch(ctx.runtime, root);
  const deny = (from: string, allowed: readonly string[]): string =>
    ctx.t("arch.generated.not_allowed", { from, allowed: allowed.join(", ") });
  const linter = arch.kind === "ok" ? importLinter(arch.config, deny) : undefined;
  const tools = [...DEV_TOOLS, ...(linter === undefined ? [] : ["import-linter"])].join(" ");
  return generateResult({
    ctx,
    root,
    files: presetFiles(project, linter),
    values,
    usage: USAGE,
    data: { schema: PRESET_SCHEMA, stack: "python", manager: project.manager },
    lines: [...(project.manager === "uv" ? [] : [ctx.t("preset.needs_uv")]), ctx.t("preset.dev_tools", { tools })],
  });
};

export const presetCommand: CommandSpec = {
  path: ["preset"],
  summaryKey: "command.preset.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: GENERATE_OPTIONS,
  run: (ctx, args) =>
    Promise.resolve(
      args.positionals[0] === "python"
        ? python(ctx, args.values)
        : failureFrom(
            ctx.t,
            usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, {
              detail: args.positionals[0] ?? "<stack>",
            }),
          ),
    ),
};
