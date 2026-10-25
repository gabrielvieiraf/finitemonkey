import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom } from "../core/result.js";
import { HOOK_EVENTS, type HookEvent, parseDeadline, parseHookEvent } from "../hooks/events.js";
import { DEFAULT_HANDLERS } from "../hooks/handlers.js";
import { type HookVerdict, runHook } from "../hooks/runner.js";
import type { CommandSpec } from "./types.js";

export interface HookData {
  readonly event: HookEvent;
  readonly verdict: HookVerdict;
}

export const hookCommand: CommandSpec = {
  path: ["hook"],
  summaryKey: "command.hook.summary",
  usage: `finitemonkey hook <${HOOK_EVENTS.join("|")}>`,
  status: "ready",
  maxPositionals: 1,
  run: async (ctx, args): Promise<CommandResult<HookData>> => {
    const raw = args.positionals[0] ?? "";
    const event = parseHookEvent(raw);
    if (event === undefined) {
      const params = { event: raw, events: HOOK_EVENTS.join(", ") };
      return failureFrom(
        ctx.t,
        usageProblem("unknown_hook_event", "error.unknown_hook_event", "finitemonkey help hook", params),
      );
    }
    const outcome = await runHook(event, {
      stdin: ctx.io.stdin,
      deadlineMs: parseDeadline(ctx.env["FINITEMONKEY_HOOK_DEADLINE_MS"]),
      handlers: DEFAULT_HANDLERS,
      cwd: ctx.cwd,
      t: ctx.t,
      startTimer: ctx.runtime.startTimer,
      runtime: ctx.runtime,
    });
    const data: HookData = { event, verdict: outcome.verdict };
    const output = { stdout: outcome.stdout, stderr: outcome.stderr };
    if (outcome.exitCode === 0) return { ok: true, exitCode: 0, data, raw: output };
    const message = outcome.stderr.trim();
    return {
      ok: false,
      exitCode: 2,
      data,
      raw: output,
      error: { code: "hook_blocked", message, fix: "finitemonkey doctor" },
    };
  },
};
