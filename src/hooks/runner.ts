import type { AbsolutePath } from "../core/brand.js";
import type { TextSource } from "../core/context.js";
import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { HOOK_POLICIES, type HookEvent } from "./events.js";
import { allow, type HookDecision, type HookHandlers, type HookInput } from "./handlers.js";
import { parseHookPayload } from "./payload.js";
import { readAll, withDeadline } from "./stdin.js";

export type HookVerdict = "allow" | "block" | "failed_open" | "failed_closed";

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
}

class HookInputError extends Error {}

const decide = async (input: HookInput, handlers: HookHandlers): Promise<HookDecision> => {
  let output: JsonObject = {};
  for (const handler of handlers[input.event] ?? [allow]) {
    const decision = await handler(input);
    if (decision.kind === "block") return decision;
    output = { ...output, ...decision.output };
  }
  return { kind: "allow", output };
};

const evaluate = async (event: HookEvent, options: HookRunOptions): Promise<HookDecision> => {
  const text = await readAll(options.stdin);
  const payload = parseHookPayload(event, text, options.stdin.isTTY === true);
  if (!payload.ok) throw new HookInputError(payload.error);
  return decide({ event, payload: payload.value, cwd: options.cwd }, options.handlers);
};

const fromDecision = (decision: HookDecision): HookOutcome =>
  decision.kind === "block"
    ? { exitCode: 2, stdout: "", stderr: `finitemonkey: ${decision.reason}\n`, verdict: "block" }
    : {
        exitCode: 0,
        stdout: `${JSON.stringify({ continue: true, ...decision.output })}\n`,
        stderr: "",
        verdict: "allow",
      };

const fromFailure = (event: HookEvent, detail: string, t: Translate): HookOutcome =>
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

export const runHook = async (event: HookEvent, options: HookRunOptions): Promise<HookOutcome> => {
  try {
    return fromDecision(await withDeadline(evaluate(event, options), options.deadlineMs, options.startTimer));
  } catch (error) {
    return fromFailure(event, error instanceof Error ? error.message : String(error), options.t);
  }
};
