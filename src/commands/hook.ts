import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { deadlineFor, HOOK_EVENTS, type HookEvent, parseHookEvent } from "../hooks/events.js";
import { logHookFailure } from "../hooks/failure-log.js";
import { DEFAULT_HANDLERS } from "../hooks/handlers.js";
import { type HookVerdict, runHook } from "../hooks/runner.js";
import { PLUGIN_VIA, projectOwnsHooks, YIELD_STDOUT } from "../install/plugin-yield.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export interface HookData {
  readonly event: HookEvent;
  readonly verdict: HookVerdict;
}

export const BENCH_RUN_ENV = "FINITEMONKEY_BENCH_RUN";

const benchOwnsHooks = (ctx: Pick<Ctx, "env">): boolean => (ctx.env[BENCH_RUN_ENV] ?? "") !== "";

const recordBenchHook = (ctx: Pick<Ctx, "env" | "cwd" | "runtime">, run: string, event: HookEvent): void => {
  const root = toAbsolutePath(ctx.env["CLAUDE_PROJECT_DIR"] ?? ctx.cwd);
  logEvent(ctx.runtime, fmPaths(root), "bench_hook", { run, hook: event });
};

export const hookCommand: CommandSpec = {
  path: ["hook"],
  summaryKey: "command.hook.summary",
  usage: `finitemonkey hook <${HOOK_EVENTS.join("|")}>`,
  status: "ready",
  maxPositionals: 1,
  options: { via: { type: "string" }, "bench-run": { type: "string" } },
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
    if (stringOption(args.values, "via") === PLUGIN_VIA && (projectOwnsHooks(ctx) || benchOwnsHooks(ctx))) {
      return { ok: true, exitCode: 0, data: { event, verdict: "allow" }, raw: { stdout: YIELD_STDOUT, stderr: "" } };
    }
    const benchRun = stringOption(args.values, "bench-run");
    if (benchRun !== undefined) recordBenchHook(ctx, benchRun, event);
    const outcome = await runHook(event, {
      stdin: ctx.io.stdin,
      deadlineMs: deadlineFor(event, ctx.env["FINITEMONKEY_HOOK_DEADLINE_MS"]),
      handlers: DEFAULT_HANDLERS,
      cwd: ctx.cwd,
      t: ctx.t,
      startTimer: ctx.runtime.startTimer,
      runtime: ctx.runtime,
      env: ctx.env,
    });
    logHookFailure(ctx, event, outcome);
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
