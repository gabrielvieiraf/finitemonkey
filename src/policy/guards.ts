import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { HOOK_EVENTS, type HookEvent } from "../hooks/events.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { toolName } from "../secrets/guards/tool-input.js";
import type { FmPaths } from "../task/paths.js";
import { pausedFor } from "./pause.js";
import { type GuardMode, loadPolicy, type Policy, STARTS_IN_SHADOW } from "./policy.js";

export interface GuardSet {
  readonly id: string;
  readonly damage: boolean;
  readonly handlers: HookHandlers;
}

export interface ShadowRecord {
  readonly firings: number;
  readonly falsePositives: number;
  readonly promoted: boolean;
}

type ShadowState = Readonly<Record<string, ShadowRecord>>;

const SHADOW_FILE = "shadow.json";

const numberOf = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) ? value : 0);

export const readShadow = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ShadowState => {
  const text = runtime.readText(paths.cache(SHADOW_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return {};
  return Object.fromEntries(
    Object.entries(parsed.value).flatMap(([id, value]): [string, ShadowRecord][] =>
      isRecord(value)
        ? [
            [
              id,
              {
                firings: numberOf(value["firings"]),
                falsePositives: numberOf(value["falsePositives"]),
                promoted: value["promoted"] === true,
              },
            ],
          ]
        : [],
    ),
  );
};

export const writeShadow = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, state: ShadowState): void => {
  runtime.writeText(paths.cache(SHADOW_FILE), `${JSON.stringify(state, null, 2)}\n`);
};

export const modeOf = (set: Pick<GuardSet, "id" | "damage">, policy: Policy, shadow: ShadowState): GuardMode => {
  if (set.damage) return "active";
  const chosen = policy.guards[set.id];
  if (chosen !== undefined) return chosen;
  if (!policy.exists && !STARTS_IN_SHADOW.has(set.id)) return "active";
  return shadow[set.id]?.promoted === true ? "active" : "shadow";
};

const recordShadow = (input: HookInput, paths: FmPaths, set: GuardSet, policy: Policy, reason: string): void => {
  const { runtime } = input;
  const state = readShadow(runtime, paths);
  const before = state[set.id] ?? { firings: 0, falsePositives: 0, promoted: false };
  const firings = before.firings + 1;
  const promoted = !before.promoted && firings >= policy.promoteAfter && before.falsePositives === 0;
  writeShadow(runtime, paths, { ...state, [set.id]: { ...before, firings, promoted: before.promoted || promoted } });
  logEvent(runtime, paths, "guard_shadow", {
    guard: set.id,
    hook: input.event,
    tool: toolName(input.payload),
    wouldHave: "block",
    reason,
  });
  if (promoted) {
    logEvent(runtime, paths, "guard_promoted", {
      guard: set.id,
      firings,
      falsePositives: before.falsePositives,
      promoteAfter: policy.promoteAfter,
    });
  }
};

const governed =
  (set: GuardSet, handler: HookHandler): HookHandler =>
  async (input): Promise<HookDecision> => {
    const paths = projectPaths(input);
    if (paths === undefined) return handler(input);
    if (pausedFor(input.runtime, paths, input.payload.sessionId) !== undefined) return { kind: "allow" };
    const policy = loadPolicy(input.runtime, paths.root);
    const mode = modeOf(set, policy, readShadow(input.runtime, paths));
    if (mode === "off") return { kind: "allow" };
    const decision = await handler(input);
    if (mode === "active" || decision.kind !== "block") return decision;
    recordShadow(input, paths, set, policy, decision.reason);
    return decision.warning === undefined
      ? { kind: "allow" }
      : { kind: "allow", output: contextOutput(input.event, decision.warning) };
  };

export const withPolicy = (set: GuardSet): HookHandlers => {
  if (set.damage) return set.handlers;
  const wrapped: Partial<Record<HookEvent, readonly HookHandler[]>> = {};
  for (const event of HOOK_EVENTS) {
    const list = set.handlers[event];
    if (list !== undefined) wrapped[event] = list.map((handler) => governed(set, handler));
  }
  return wrapped;
};
