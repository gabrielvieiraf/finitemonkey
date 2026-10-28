import type { AbsolutePath } from "../core/brand.js";
import type { Env, TextSource } from "../core/context.js";
import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { HOOK_POLICIES, type HookEvent } from "./events.js";
import { allow, composeDecisions, type HookDecision, type HookHandlers, type HookInput } from "./handlers.js";
import { type HookPayload, parseHookPayload } from "./payload.js";
import { readAll, withDeadline } from "./stdin.js";

export const HOOK_PROBE_ENV = "FINITEMONKEY_HOOK_PROBE";

export type HookVerdict = "allow" | "block" | "failed_open" | "failed_closed" | "stop_released";

export interface HookOutcome {
  readonly exitCode: 0 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly verdict: HookVerdict;
}

export interface HookRunOptions {
  readonly stdin: TextSource;
  readonly deadlineMs: number;
  readonly handlers: HookHandlers;
  readonly cwd: AbsolutePath;
  readonly t: Translate;
  readonly startTimer: Runtime["startTimer"];
  readonly runtime: Runtime;
  readonly env?: Env;
}

type Evaluation =
  | { readonly kind: "decided"; readonly payload: HookPayload; readonly decision: HookDecision }
  | { readonly kind: "failed"; readonly payload: HookPayload | undefined; readonly detail: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const decide = (input: HookInput, handlers: HookHandlers): Promise<HookDecision> =>
  composeDecisions(input, handlers[input.event] ?? [allow]);

const evaluate = async (event: HookEvent, options: HookRunOptions): Promise<Evaluation> => {
  const text = await readAll(options.stdin);
  const parsed = parseHookPayload(event, text, options.stdin.isTTY === true);
  if (!parsed.ok) return { kind: "failed", payload: undefined, detail: parsed.error };
  const payload = parsed.value;
  if (options.env?.[HOOK_PROBE_ENV] === "1") return { kind: "decided", payload, decision: { kind: "allow" } };
  try {
    return {
      kind: "decided",
      payload,
      decision: await decide(
        { event, payload, cwd: options.cwd, runtime: options.runtime, t: options.t, env: options.env ?? {} },
        options.handlers,
      ),
    };
  } catch (error) {
    return { kind: "failed", payload, detail: messageOf(error) };
  }
};

const ALLOW_STDOUT = `${JSON.stringify({ continue: true })}\n`;

const allowed = (output: JsonObject | undefined): HookOutcome => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ continue: true, ...output })}\n`,
  stderr: "",
  verdict: "allow",
});

const released = (event: HookEvent, detail: string, t: Translate): HookOutcome => ({
  exitCode: 0,
  stdout: ALLOW_STDOUT,
  stderr: `finitemonkey: ${t("hook.stop_released", { event, detail })}\n`,
  verdict: "stop_released",
});

const failed = (event: HookEvent, detail: string, t: Translate): HookOutcome =>
  HOOK_POLICIES[event].failClosed
    ? {
        exitCode: 2,
        stdout: "",
        stderr: `finitemonkey: ${t("hook.failed_closed", { event, detail })}\n`,
        verdict: "failed_closed",
      }
    : {
        exitCode: 0,
        stdout: "",
        stderr: `finitemonkey: ${t("hook.failed_open", { event, detail })}\n`,
        verdict: "failed_open",
      };

const worktreeCreated = (output: JsonObject | undefined, t: Translate): HookOutcome => {
  const path = output?.["worktreePath"];
  if (typeof path === "string" && path !== "")
    return { exitCode: 0, stdout: `${path}\n`, stderr: "", verdict: "allow" };
  return failed("WorktreeCreate", "no worktree path", t);
};

const conclude = (event: HookEvent, evaluation: Evaluation, t: Translate, probe: boolean): HookOutcome => {
  const stopActive = evaluation.payload?.stopHookActive === true;
  if (evaluation.kind === "failed") {
    return stopActive ? released(event, evaluation.detail, t) : failed(event, evaluation.detail, t);
  }
  const { decision } = evaluation;
  if (decision.kind === "allow") {
    return event === "WorktreeCreate" && !probe ? worktreeCreated(decision.output, t) : allowed(decision.output);
  }
  if (stopActive && decision.persistent !== true) return released(event, decision.reason, t);
  if (decision.output !== undefined) {
    return { exitCode: 0, stdout: `${JSON.stringify(decision.output)}\n`, stderr: "", verdict: "block" };
  }
  return { exitCode: 2, stdout: "", stderr: `finitemonkey: ${decision.reason}\n`, verdict: "block" };
};

export const runHook = async (event: HookEvent, options: HookRunOptions): Promise<HookOutcome> => {
  try {
    return conclude(
      event,
      await withDeadline(evaluate(event, options), options.deadlineMs, options.startTimer),
      options.t,
      options.env?.[HOOK_PROBE_ENV] === "1",
    );
  } catch (error) {
    return failed(event, messageOf(error), options.t);
  }
};
