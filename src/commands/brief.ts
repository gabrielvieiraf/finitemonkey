import { usageProblem } from "../core/problem.js";
import type { CommandResult } from "../core/result.js";
import { failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import {
  BRIEFING_FILE,
  BRIEFING_MAX_LINES,
  briefingPath,
  frontPrompt,
  lineCount,
  renderBriefing,
} from "../fronts/brief.js";
import { readFronts } from "../fronts/state.js";
import { mainRoot } from "./fronts.js";
import type { CommandSpec } from "./types.js";

export const BRIEF_SCHEMA = "finitemonkey/brief@1";

export const briefCommand: CommandSpec = {
  path: ["brief"],
  summaryKey: "fronts.command.brief",
  usage: "finitemonkey brief [--json]",
  status: "ready",
  run: (ctx): Promise<CommandResult> => {
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
    const text = renderBriefing(ctx.runtime, root, state.value);
    const written = ctx.dryRun ? { ok: true as const } : ctx.runtime.writeText(briefingPath(root), text);
    if (!written.ok) {
      return Promise.resolve(
        failureFrom(ctx.t, {
          ...usageProblem("fronts_failed", "fronts.error.apply", "finitemonkey doctor", { detail: written.error }),
          exitCode: ExitCode.CheckFailed,
        }),
      );
    }
    const prompts = state.value.fronts.map((front) => ({ front: front.id, prompt: frontPrompt(front) }));
    const lines = lineCount(text);
    return Promise.resolve(
      success({ schema: BRIEF_SCHEMA, file: BRIEFING_FILE, lines, ceiling: BRIEFING_MAX_LINES, prompts }, [
        ctx.t("fronts.brief.done", { file: BRIEFING_FILE, lines, ceiling: BRIEFING_MAX_LINES }),
        ...prompts.flatMap((item) => ["", item.prompt]),
      ]),
    );
  },
};
