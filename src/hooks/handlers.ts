import { ADVISOR_HANDLERS } from "../advisor/hook.js";
import { appsecEditWarning } from "../appsec/hook.js";
import { CLAIMS_HANDLERS } from "../claims/guard.js";
import { CLARIFY_HANDLERS } from "../clarify/hook.js";
import { CONCEITOS_HANDLERS } from "../conceitos/hooks.js";
import { type TonedConcept, tonedHuman } from "../conceitos/tone.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { credsStaticGuard } from "../creds/static-guard.js";
import { DEPLOY_HANDLERS } from "../deploy/hooks.js";
import { depsGuard } from "../deps/guard.js";
import { logEvent } from "../evidence/log.js";
import { projectPaths } from "../gate/hooks/common.js";
import { PORTAO_HANDLERS } from "../gate/hooks/index.js";
import { GIT_HANDLERS } from "../git/hooks/index.js";
import { TESTS_HOLD_HANDLERS } from "../guards/tests/hold.js";
import type { Translate } from "../i18n/translate.js";
import { instructionsLoaded } from "../instructions/log.js";
import { LEARNINGS_HANDLERS } from "../learnings/hooks.js";
import { PERFIL_HANDLERS } from "../perfil/hooks.js";
import { LABEL_HANDLERS, PLANTA_HANDLERS } from "../planta/hooks.js";
import { type GuardSet, withPolicy } from "../policy/guards.js";
import { PROSE_HANDLERS } from "../prose/hooks.js";
import { QUALITY_HANDLERS } from "../quality/hook.js";
import { RELAY_HANDLERS } from "../relay/hook.js";
import { REMINDERS_HANDLERS } from "../reminders/hooks.js";
import { REUSE_HANDLERS } from "../reuse/hook.js";
import { RICOCHETE_HANDLERS } from "../ricochete/stop.js";
import { rulesGuard } from "../rules/guard.js";
import { rulesStop } from "../rules/stop.js";
import { secretsPostToolUse, secretsUserPromptSubmit } from "../secrets/guards/exposure.js";
import { secretsPreToolUse } from "../secrets/guards/pre-tool.js";
import { secretsSessionStart } from "../secrets/guards/session.js";
import { toolName } from "../secrets/guards/tool-input.js";
import { FOURTH_ATTEMPT_HANDLERS, SIGNALS_HANDLERS } from "../signals/hooks.js";
import { SLOP_HANDLERS } from "../slop/hook.js";
import { HEAVY_HANDLERS } from "../wt/heavy-hooks.js";
import { WT_PLACE_HANDLERS } from "../wt/place-hook.js";
import { WT_SUGGEST_HANDLERS } from "../wt/suggest-hooks.js";
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
      readonly warning?: string;
      readonly concept?: TonedConcept;
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

const toned = (input: HookInput, decision: Extract<HookDecision, { kind: "block" }>): string | undefined => {
  const paths = projectPaths(input);
  if (decision.concept === undefined || decision.human === undefined || paths === undefined) return decision.human;
  if (input.runtime.stat(paths.dir)?.kind !== "dir") return decision.human;
  return tonedHuman(input.runtime, paths, input.t, decision.concept, decision.human);
};

const shaped = (input: HookInput, decision: Extract<HookDecision, { kind: "block" }>): HookDecision => {
  recordBlock(input, decision);
  if (input.event !== "PreToolUse" || decision.output !== undefined) return decision;
  const human = toned(input, decision);
  const reason = capReason(decision.reason);
  return {
    ...decision,
    reason,
    output: {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
      systemMessage: `finitemonkey: ${human ?? input.t("reason.human.generic")}`,
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
  { id: "creds-static", damage: false, handlers: { PreToolUse: [credsStaticGuard] } },
  { id: "appsec", damage: false, handlers: { PreToolUse: [appsecEditWarning] } },
  { id: "rules", damage: true, handlers: { PreToolUse: [rulesGuard] } },
  { id: "signals", damage: false, handlers: SIGNALS_HANDLERS },
  { id: "fourth-attempt", damage: false, handlers: FOURTH_ATTEMPT_HANDLERS },
  { id: "ricochete", damage: false, handlers: RICOCHETE_HANDLERS },
  { id: "planta", damage: false, handlers: PLANTA_HANDLERS },
  { id: "label", damage: false, handlers: LABEL_HANDLERS },
  { id: "perfil", damage: false, handlers: PERFIL_HANDLERS },
  { id: "conceitos", damage: false, handlers: CONCEITOS_HANDLERS },
  { id: "relay", damage: false, handlers: RELAY_HANDLERS },
  { id: "reuse", damage: false, handlers: REUSE_HANDLERS },
  { id: "quality", damage: false, handlers: QUALITY_HANDLERS },
  { id: "slop", damage: false, handlers: SLOP_HANDLERS },
  { id: "tests-hold", damage: false, handlers: TESTS_HOLD_HANDLERS },
  { id: "advisor", damage: false, handlers: ADVISOR_HANDLERS },
  { id: "claims", damage: false, handlers: CLAIMS_HANDLERS },
  { id: "clarify", damage: false, handlers: CLARIFY_HANDLERS },
  { id: "deploy", damage: false, handlers: DEPLOY_HANDLERS },
  { id: "wt-suggest", damage: false, handlers: WT_SUGGEST_HANDLERS },
  { id: "heavy-lock", damage: false, handlers: HEAVY_HANDLERS },
  { id: "instructions", damage: false, handlers: { InstructionsLoaded: [instructionsLoaded] } },
  { id: "rules-stop", damage: false, handlers: { Stop: [rulesStop] } },
  { id: "reminders", damage: false, handlers: REMINDERS_HANDLERS },
  { id: "learnings", damage: false, handlers: LEARNINGS_HANDLERS },
];

export const DEFAULT_HANDLERS: HookHandlers = mergeHandlers(...GUARD_SETS.map(withPolicy), WT_PLACE_HANDLERS);
