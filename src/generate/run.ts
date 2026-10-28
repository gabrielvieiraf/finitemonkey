import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import { projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { type GenEntry, type GenFile, planFiles, type PlannedFile, writable, writeFiles } from "./files.js";
import { projectFormatter } from "./format.js";

export const GEN_SCHEMA = "finitemonkey/gen@1";

export interface GenRequest {
  readonly generator: string;
  readonly feature: string;
  readonly files: readonly GenFile[];
  readonly notes: readonly string[];
  readonly rerun: string;
}

export interface GenData {
  readonly schema: typeof GEN_SCHEMA;
  readonly generator: string;
  readonly mode: GuardMode;
  readonly entries: readonly GenEntry[];
  readonly written: readonly string[];
  readonly notes: readonly string[];
}

const entryLines = (ctx: Ctx, entry: GenEntry): readonly string[] => [
  ctx.t(`gen.status.${entry.status}`, { path: entry.path }),
  ...entry.diff.map((line) => `    ${line}`),
];

const dataOf = (
  request: GenRequest,
  mode: GuardMode,
  entries: readonly PlannedFile[],
  written: readonly string[],
): GenData => ({
  schema: GEN_SCHEMA,
  generator: request.generator,
  mode,
  entries: entries.map(({ path, status, diff }) => ({ path, status, diff })),
  written,
  notes: request.notes,
});

const planLines = (ctx: Ctx, request: GenRequest, entries: readonly PlannedFile[]): readonly string[] => [
  ctx.t("gen.title", { generator: request.generator }),
  ...entries.flatMap((entry) => entryLines(ctx, entry)),
  ...request.notes,
  ...(entries.some((entry) => entry.status === "differs") ? [ctx.t("gen.kept")] : []),
];

export const runGenerator = (ctx: Ctx, request: GenRequest): CommandResult<GenData> => {
  const root = projectRoot(ctx);
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, request.feature);
  if (mode === "off") return success(dataOf(request, mode, [], []), [ctx.t("gen.off", { feature: request.feature })]);
  const entries = planFiles(ctx.runtime, root, request.files, projectFormatter(ctx.runtime, root));
  const human = planLines(ctx, request, entries);
  const pending = entries.filter(writable);
  if (pending.length === 0) return success(dataOf(request, mode, entries, []), [...human, ctx.t("gen.nothing")]);
  if (!ctx.yes || ctx.dryRun) {
    return { ...success(dataOf(request, mode, entries, []), [...human, ctx.t("gen.preview")]), next: request.rerun };
  }
  if (mode === "shadow") {
    recordFeatureShadow(ctx.runtime, paths, request.feature, { files: pending.map((entry) => entry.path) });
    return success(dataOf(request, mode, entries, []), [...human, ctx.t("gen.shadow", { feature: request.feature })]);
  }
  const written = writeFiles(ctx.runtime, root, entries);
  if (!written.ok) {
    return failureFrom(ctx.t, {
      code: "gen_write_failed",
      messageKey: "gen.error.write",
      params: { detail: written.error },
      fix: "check that the project folder can be written, then run the command again",
      exitCode: ExitCode.CheckFailed,
      data: dataOf(request, mode, entries, []),
    });
  }
  return success(dataOf(request, mode, entries, written.value), [
    ...human,
    ctx.t("gen.written", { count: written.value.length }),
  ]);
};
