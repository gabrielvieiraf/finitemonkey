import { stringOption } from "../core/args.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { readFronts } from "../fronts/state.js";
import { syncTaskMap } from "../fronts/sync.js";
import { mainRoot } from "./fronts.js";
import type { CommandSpec } from "./types.js";

export const FRONTS_SYNC_SCHEMA = "finitemonkey/fronts-sync@1";

export const frontsSyncCommand: CommandSpec = {
  path: ["fronts", "sync"],
  summaryKey: "fronts.command.sync",
  usage: "finitemonkey fronts sync [--github-project <n>] [--offline] [--json]",
  status: "ready",
  options: { "github-project": { type: "string" }, offline: { type: "boolean" } },
  run: (ctx, args): Promise<CommandResult> => {
    const root = mainRoot(ctx);
    const state = readFronts(ctx.runtime, root);
    if (!state.ok) {
      return Promise.resolve(
        failureFrom(ctx.t, {
          ...usageProblem("fronts_failed", "fronts.error.bad_state", "finitemonkey fronts status", {
            detail: state.error,
          }),
          exitCode: ExitCode.CheckFailed,
        }),
      );
    }
    const result = syncTaskMap(
      ctx.runtime,
      root,
      state.value,
      stringOption(args.values, "github-project"),
      args.values["offline"] === true,
    );
    const key = result.source === "github" ? "fronts.sync.github" : "fronts.sync.local";
    return Promise.resolve(
      success({ schema: FRONTS_SYNC_SCHEMA, ...result }, [
        ctx.t(key, { file: result.file, count: result.rows.length }),
      ]),
    );
  },
};
