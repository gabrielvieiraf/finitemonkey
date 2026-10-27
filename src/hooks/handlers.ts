import type { AbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { depsGuard } from "../deps/guard.js";
import { logEvent } from "../evidence/log.js";
import { projectPaths } from "../gate/hooks/common.js";
import { PORTAO_HANDLERS } from "../gate/hooks/index.js";
import { GIT_HANDLERS } from "../git/hooks/index.js";
import type { Translate } from "../i18n/translate.js";
import { type GuardSet, withPolicy } from "../policy/guards.js";
import { PROSE_HANDLERS } from "../prose/hooks.js";
import { rulesGuard } from "../rules/guard.js";
import { secretsPostToolUse, secretsUserPromptSubmit } from "../secrets/guards/exposure.js";
import { secretsPreToolUse } from "../secrets/guards/pre-tool.js";
import { secretsSessionStart } from "../secrets/guards/session.js";
import { toolName } from "../secrets/guards/tool-input.js";
import { HOOK_EVENTS, type HookEvent } from "./events.js";
import type { HookPayload } from "./payload.js";
import { capReason } from "./reason.js";

export interface HookInput {
  readonly event: HookEvent;
  readonly payload: HookPayload;
  readonly cwd: AbsolutePath;
  readonly runtime: Runtime;
  readonly t: Translate;
  readonly env: Env;
}

export type HookDecision =
  | { readonly kind: "allow"; readonly output?: JsonObject }
  | {
      readonly kind: "block";
      readonly reason: string;
      readonly human?: string;
      readonly output?: JsonObject;
      readonly persistent?: boolean;
    };

export type HookHandler = (input: HookInput) => HookDecision | Promise<HookDecision>;

export type HookHandlers = Readonly<Partial<Record<HookEvent, readonly HookHandler[]>>>;

export const allow: HookHandler = () => ({ kind: "allow" });

const DECISION_RANK: Readonly<Record<string, number>> = { allow: 0, defer: 0, ask: 1, deny: 2 };

const joinText = (left: unknown, right: unknown): unknown => {
  if (typeof left !== "string" || left === "") return right;
  if (typeof right !== "string" || right === "") return left;
  return `${left}\n${right}`;
};

const mergeSpecific = (left: unknown, right: unknown): unknown => {
  if (!isRecord(left)) return right;
  if (!isRecord(right)) return left;
  const merged: Record<string, unknown> = { ...left, ...right };
  merged["additionalContext"] = joinText(left["additionalContext"], right["additionalContext"]);
  const leftRank = DECISION_RANK[String(left["permissionDecision"])] ?? -1;
  const rightRank = DECISION_RANK[String(right["permissionDecision"])] ?? -1;
  if (leftRank > rightRank) {
    merged["permissionDecision"] = left["permissionDecision"];
    merged["permissionDecisionReason"] = left["permissionDecisionReason"];
  }
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
};

export const mergeOutputs = (left: JsonObject, right: JsonObject | undefined): JsonObject => {
  if (right === undefined) return left;
  const merged: Record<string, unknown> = { ...left, ...right };
  const systemMessage = joinText(left["systemMessage"], right["systemMessage"]);
  if (systemMessage !== undefined) merged["systemMessage"] = systemMessage;
  const specific = mergeSpecific(left["hookSpecificOutput"], right["hookSpecificOutput"]);
  if (specific !== undefined) merged["hookSpecificOutput"] = specific;
  return merged;
};

const recordBlock = (input: HookInput, decision: Extract<HookDecision, { kind: "block" }>): void => {
  const paths = projectPaths(input);
  if (paths === undefined) return;
  logEvent(input.runtime, paths, "guard_block", {
    hook: input.event,
    tool: toolName(input.payload),
    sessionId: input.payload.sessionId ?? null,
    claim: (decision.reason.split("\n")[0] ?? "").slice(0, 200),
  });
};

const shaped = (input: HookInput, decision: Extract<HookDecision, { kind: "block" }>): HookDecision => {
  recordBlock(input, decision);
  if (input.event !== "PreToolUse" || decision.output !== undefined) return decision;
  const reason = capReason(decision.reason);
  return {
    ...decision,
    reason,
    output: {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
      systemMessage: `finitemonkey: ${decision.human ?? input.t("reason.human.generic")}`,
    },
  };
};

export const composeDecisions = async (input: HookInput, handlers: readonly HookHandler[]): Promise<HookDecision> => {
  let output: JsonObject = {};
  for (const handler of handlers) {
    const decision = await handler(input);
    if (decision.kind === "block") return shaped(input, decision);
    output = mergeOutputs(output, decision.output);
  }
  return { kind: "allow", output };
};

export const mergeHandlers = (...sets: readonly HookHandlers[]): HookHandlers => {
  const merged: Partial<Record<HookEvent, readonly HookHandler[]>> = {};
  for (const set of sets) {
    for (const event of HOOK_EVENTS) {
      const list = set[event];
      if (list !== undefined) merged[event] = [...(merged[event] ?? []), ...list];
    }
  }
  return merged;
};

export const SECRETS_HANDLERS: HookHandlers = {
  PreToolUse: [secretsPreToolUse],
  UserPromptSubmit: [secretsUserPromptSubmit],
  PostToolUse: [secretsPostToolUse],
  SessionStart: [secretsSessionStart],
};

export const GUARD_SETS: readonly GuardSet[] = [
  { id: "secrets", damage: true, handlers: SECRETS_HANDLERS },
  { id: "gate", damage: true, handlers: PORTAO_HANDLERS },
  { id: "prose", damage: false, handlers: PROSE_HANDLERS },
  { id: "git", damage: true, handlers: GIT_HANDLERS },
  { id: "deps", damage: false, handlers: { PreToolUse: [depsGuard] } },
  { id: "rules", damage: true, handlers: { PreToolUse: [rulesGuard] } },
];

export const DEFAULT_HANDLERS: HookHandlers = mergeHandlers(...GUARD_SETS.map(withPolicy));
