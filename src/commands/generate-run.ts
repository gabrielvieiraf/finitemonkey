import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { applyFiles, type GeneratedFile, planFiles } from "../generate/plan.js";
import { isPerson } from "../secrets/project.js";
import { planLines } from "./arch.js";
import type { OptionValue } from "./types.js";

export const GENERATE_OPTIONS = { write: { type: "boolean" }, overwrite: { type: "boolean" } } as const;

export interface GenerateRun {
  readonly ctx: Ctx;
  readonly root: AbsolutePath;
  readonly files: readonly GeneratedFile[];
  readonly values: Readonly<Record<string, OptionValue>>;
  readonly usage: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly lines: readonly string[];
}

export const generateResult = (run: GenerateRun): CommandResult => {
  const { ctx, root, files, values } = run;
  const overwrite = values["overwrite"] === true;
  if (values["write"] === true && overwrite && !isPerson(ctx))
    return failureFrom(ctx.t, needsPersonProblem("generate.error.person_only", run.usage));
  const plan = planFiles(ctx.runtime, root, files);
  const applied =
    values["write"] === true ? applyFiles(ctx.runtime, root, files, overwrite) : { written: [], proposed: [] };
  return success({ ...run.data, files: plan, ...applied }, [
    ...planLines(ctx, plan),
    ...applied.written.map((file) => ctx.t("generate.written", { file })),
    ...applied.proposed.map((file) => ctx.t("generate.proposed", { file })),
    ...run.lines,
  ]);
};
