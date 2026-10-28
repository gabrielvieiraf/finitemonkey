import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { readFronts } from "../fronts/state.js";
import { finishWave, personLines } from "../fronts/wave-finish.js";
import { mergeWave, type WaveFailure } from "../fronts/wave-merge.js";
import { mainRoot } from "./fronts.js";
import type { CommandSpec, OptionValues } from "./types.js";
import { commandOwner } from "./wt.js";

export const FRONTS_MERGE_SCHEMA = "finitemonkey/fronts-merge@1";

const checksOf = (values: OptionValues): readonly string[] => {
  const value = values["check"];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const detailOf = (failure: WaveFailure): string => {
  switch (failure.kind) {
    case "no-fronts":
      return "no front is reported or verified";
    case "reports":
      return failure.checks.map((check) => `${check.front}: ${check.problems.join("; ")}`).join(" | ");
    case "cycle":
      return `blocked_by cycle among ${failure.fronts.join(", ")}`;
    case "base":
    case "wave-checks":
      return failure.detail;
    case "merge":
      return `${failure.front}: ${failure.detail}`;
  }
};

const failed = (ctx: Ctx, failure: WaveFailure): CommandResult => ({
  ...failureFrom(ctx.t, {
    ...usageProblem("fronts_merge_failed", "fronts.error.merge", "finitemonkey fronts status", {
      detail: detailOf(failure),
    }),
    exitCode: ExitCode.CheckFailed,
  }),
  data: { schema: FRONTS_MERGE_SCHEMA, failure },
});

export const frontsMergeCommand: CommandSpec = {
  path: ["fronts", "merge"],
  summaryKey: "fronts.command.merge",
  usage: "finitemonkey fronts merge [--check <command>]... [--json]",
  status: "ready",
  options: { check: { type: "string", multiple: true } },
  run: (ctx, args): Promise<CommandResult> => {
    const root = mainRoot(ctx);
    const state = readFronts(ctx.runtime, root);
    if (!state.ok) return Promise.resolve(failed(ctx, { kind: "base", detail: state.error }));
    const options = {
      runtime: ctx.runtime,
      root,
      env: ctx.env,
      owner: commandOwner(ctx),
      checks: checksOf(args.values),
    };
    const wave = mergeWave(options, state.value);
    if (!wave.ok) return Promise.resolve(failed(ctx, wave.error));
    const cleaned = finishWave(options, state.value, wave.value);
    const data = { schema: FRONTS_MERGE_SCHEMA, ...wave.value, cleaned };
    return Promise.resolve(
      success(data, [
        ctx.t("fronts.merge.done", {
          branch: wave.value.branch,
          head: wave.value.head.slice(0, 12),
          count: wave.value.merges.length,
        }),
        ...personLines(wave.value.checks),
      ]),
    );
  },
};
