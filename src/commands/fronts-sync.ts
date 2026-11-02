import { stringOption } from "../core/args.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { githubStep } from "../fronts/github-consent.js";
import { readFronts } from "../fronts/state.js";
import { syncTaskMap } from "../fronts/sync.js";
import { mainRoot } from "./fronts.js";
import type { CommandSpec } from "./types.js";

export const FRONTS_SYNC_SCHEMA = "finitemonkey/fronts-sync@1";

export const frontsSyncCommand: CommandSpec = {
  path: ["fronts", "sync"],
  summaryKey: "fronts.command.sync",
  usage: "finitemonkey fronts sync [--github-project <n>] [--offline] [--github [--github-field <name>]] [--json]",
  status: "ready",
  options: {
    "github-project": { type: "string" },
    offline: { type: "boolean" },
    github: { type: "boolean" },
    "github-field": { type: "string" },
  },
  run: async (ctx, args): Promise<CommandResult> => {
    const root = mainRoot(ctx);
    const state = readFronts(ctx.runtime, root);
    if (!state.ok) {
      return failureFrom(ctx.t, {
        ...usageProblem("fronts_failed", "fronts.error.bad_state", "finitemonkey fronts status", {
          detail: state.error,
        }),
        exitCode: ExitCode.CheckFailed,
      });
    }
    const project = stringOption(args.values, "github-project");
    const result = syncTaskMap(ctx.runtime, root, state.value, project, args.values["offline"] === true);
    const key = result.source === "github" ? "fronts.sync.github" : "fronts.sync.local";
    const github =
      args.values["github"] === true
        ? await githubStep(ctx, root, state.value, project, stringOption(args.values, "github-field") ?? "Front")
        : undefined;
    const { line, ...written } = github ?? { line: undefined };
    return success({ schema: FRONTS_SYNC_SCHEMA, ...result, ...(github === undefined ? {} : { github: written }) }, [
      ctx.t(key, { file: result.file, count: result.rows.length }),
      ...(line === undefined ? [] : [line]),
    ]);
  },
};
