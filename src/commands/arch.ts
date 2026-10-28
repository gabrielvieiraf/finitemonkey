import { join } from "node:path";

import { ARCH_FILE, loadArch } from "../arch/config.js";
import { archFiles, type ArchTool, detectArchTools, isArchTool, type ProjectProbe } from "../arch/generate.js";
import { goModuleOf } from "../arch/imports.js";
import { archFindings, workingTree } from "../arch/scan.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { changedFiles, gitAt, resolveBase } from "../gate/git.js";
import { applyFiles, type GeneratedFile, planFiles, type PlannedFile } from "../generate/plan.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import type { CommandSpec, OptionValue } from "./types.js";

export const ARCH_SCHEMA = "finitemonkey/arch@1";
const USAGE = "finitemonkey arch [--tool <name>]... [--write] [--overwrite]";

const probeAt = (ctx: Ctx, root: AbsolutePath): ProjectProbe => {
  const read = ctx.runtime.readText(toAbsolutePath(join(root, "go.mod")));
  return {
    exists: (relative) => ctx.runtime.stat(toAbsolutePath(join(root, relative))) !== undefined,
    goModule: goModuleOf(read.ok ? read.value : undefined),
  };
};

const toolsFrom = (raw: OptionValue): readonly string[] =>
  Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string")
    : typeof raw === "string"
      ? [raw]
      : [];

export const planLines = (ctx: Ctx, plan: readonly PlannedFile[]): readonly string[] =>
  plan.flatMap((item) => [ctx.t(`generate.status.${item.status}`, { file: item.path }), ...item.diff]);

const violationCount = (ctx: Ctx, root: AbsolutePath, files: Parameters<typeof archFindings>[0]): number => {
  const git = gitAt(ctx.runtime, root);
  return archFindings(files, workingTree(ctx.runtime, git, root, changedFiles(git, resolveBase(git, undefined))))
    .length;
};

const write = (ctx: Ctx, root: AbsolutePath, files: readonly GeneratedFile[], overwrite: boolean) => {
  if (overwrite && !isPerson(ctx)) return undefined;
  return applyFiles(ctx.runtime, root, files, overwrite);
};

const run = (ctx: Ctx, values: Readonly<Record<string, OptionValue>>): CommandResult => {
  const root = projectRoot(ctx);
  const loaded = loadArch(ctx.runtime, root);
  if (loaded.kind === "absent")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "arch.error.no_config", USAGE, { file: ARCH_FILE }));
  if (loaded.kind === "invalid")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "arch.error.invalid", USAGE, { issues: loaded.issues.join("; ") }),
    );
  const asked = toolsFrom(values["tool"]);
  const unknown = asked.find((tool) => !isArchTool(tool));
  if (unknown !== undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: unknown }));
  const probe = probeAt(ctx, root);
  const tools: readonly ArchTool[] = asked.length > 0 ? asked.filter(isArchTool) : detectArchTools(probe);
  const deny = (from: string, allowed: readonly string[]): string =>
    ctx.t("arch.generated.not_allowed", { from, allowed: allowed.join(", ") });
  const files = archFiles(loaded.config, tools, deny, probe);
  const plan = planFiles(ctx.runtime, root, files);
  const applied =
    values["write"] === true ? write(ctx, root, files, values["overwrite"] === true) : { written: [], proposed: [] };
  if (applied === undefined) return failureFrom(ctx.t, needsPersonProblem("generate.error.person_only", USAGE));
  const violations = violationCount(ctx, root, loaded.config);
  return success({ schema: ARCH_SCHEMA, tools, files: plan, ...applied, violations }, [
    ...planLines(ctx, plan),
    ...applied.written.map((file) => ctx.t("generate.written", { file })),
    ...applied.proposed.map((file) => ctx.t("generate.proposed", { file })),
    ctx.t("arch.violations", { count: violations }),
  ]);
};

export const archCommand: CommandSpec = {
  path: ["arch"],
  summaryKey: "command.arch.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { tool: { type: "string", multiple: true }, write: { type: "boolean" }, overwrite: { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(run(ctx, args.values)),
};
