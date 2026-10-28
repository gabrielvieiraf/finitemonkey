import { join } from "node:path";

import { detectProject, type Project } from "../apicontract/framework.js";
import { contractFiles, mockFiles } from "../apicontract/generate.js";
import { contractCoverage, loadRegistry } from "../apicontract/load.js";
import { type ApiRegistry, CONTRACT_FILE } from "../apicontract/registry.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import type { GeneratedFile } from "../generate/plan.js";
import { projectRoot } from "../secrets/project.js";
import { GENERATE_OPTIONS, generateResult } from "./generate-run.js";
import type { CommandSpec, OptionValue } from "./types.js";

export const API_CONTRACT_SCHEMA = "finitemonkey/api-contract@1";
const USAGE = "finitemonkey contract [mocks|coverage] [--write] [--overwrite]";

const projectAt = (ctx: Ctx, root: AbsolutePath): Project =>
  detectProject(
    (relative) => {
      const text = ctx.runtime.readText(toAbsolutePath(join(root, relative)));
      return text.ok ? text.value : undefined;
    },
    (relative) => ctx.runtime.stat(toAbsolutePath(join(root, relative))) !== undefined,
  );

const withRegistry = (ctx: Ctx, run: (root: AbsolutePath, registry: ApiRegistry) => CommandResult): CommandResult => {
  const root = projectRoot(ctx);
  const loaded = loadRegistry(ctx.runtime, root);
  if (loaded.kind === "absent")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "contract.error.no_registry", USAGE, { file: CONTRACT_FILE }),
    );
  if (loaded.kind === "invalid")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "contract.error.invalid", USAGE, { issues: loaded.issues.join("; ") }),
    );
  return run(root, loaded.registry);
};

const generate = (
  ctx: Ctx,
  values: Readonly<Record<string, OptionValue>>,
  make: (registry: ApiRegistry, project: Project) => readonly GeneratedFile[],
  hint: "contract.next" | "contract.mocks.next",
): CommandResult =>
  withRegistry(ctx, (root, registry) => {
    const project = projectAt(ctx, root);
    return generateResult({
      ctx,
      root,
      files: make(registry, project),
      values,
      usage: USAGE,
      data: { schema: API_CONTRACT_SCHEMA, framework: project.framework ?? null, base: project.base },
      lines: [ctx.t(hint, { base: project.base, framework: project.framework ?? "?" })],
    });
  });

const coverage = (ctx: Ctx): CommandResult =>
  withRegistry(ctx, (root, registry) => {
    const problems = contractCoverage(ctx.runtime, root, registry);
    const lines = problems.map((problem) => ctx.t(`gate.contract.${problem.kind}`, { ...problem }));
    if (problems.length === 0)
      return success({ schema: API_CONTRACT_SCHEMA, problems }, [ctx.t("gate.contract.clean")]);
    return {
      ok: false,
      exitCode: ExitCode.CheckFailed,
      data: { schema: API_CONTRACT_SCHEMA, problems },
      human: lines,
      error: { code: "gate_failed", message: lines.join("\n"), fix: "finitemonkey contract mocks" },
    };
  });

export const contractCommand: CommandSpec = {
  path: ["contract"],
  summaryKey: "command.contract.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: GENERATE_OPTIONS,
  run: (ctx, args) => {
    const [action = ""] = args.positionals;
    if (action === "mocks") return Promise.resolve(generate(ctx, args.values, mockFiles, "contract.mocks.next"));
    if (action === "coverage") return Promise.resolve(coverage(ctx));
    if (action !== "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: action })),
      );
    return Promise.resolve(generate(ctx, args.values, contractFiles, "contract.next"));
  },
};
