import { nowMs } from "../core/clock.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { HOOK_EVENTS, type HookEvent } from "../hooks/events.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { toolName } from "../secrets/guards/tool-input.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { ALERT_BUDGET_FEATURE, isMuted, recordFiring } from "./budget.js";
import { experimentArm } from "./experiment.js";
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

export type ModeSource = "built-in" | "experiment" | "project" | "user" | "default" | "promoted" | "evolved";

export interface Override {
  readonly source: "project" | "user";
  readonly mode: GuardMode;
}

export interface GuardResolution {
  readonly mode: GuardMode;
  readonly source: ModeSource;
  readonly ignored: readonly Override[];
}

const STRENGTH: Readonly<Record<GuardMode, number>> = { off: 0, shadow: 1, active: 2 };

const fallback = (id: string, shadow: ShadowState): GuardResolution => {
  if (!STARTS_IN_SHADOW.has(id)) return { mode: "active", source: "default", ignored: [] };
  return shadow[id]?.promoted === true
    ? { mode: "active", source: "promoted", ignored: [] }
    : { mode: "shadow", source: "default", ignored: [] };
};

export const resolveGuard = (
  set: Pick<GuardSet, "id" | "damage">,
  policy: Policy,
  shadow: ShadowState,
  arm?: GuardMode,
): GuardResolution => {
  const project = policy.guards[set.id];
  const user = policy.userGuards[set.id];
  const levels: readonly Override[] = [
    ...(project === undefined ? [] : [{ source: "project" as const, mode: project }]),
    ...(user === undefined ? [] : [{ source: "user" as const, mode: user }]),
  ];
  if (set.damage) {
    return { mode: "active", source: "built-in", ignored: levels.filter((level) => level.mode !== "active") };
  }
  if (arm !== undefined) return { mode: arm, source: "experiment", ignored: levels };
  const evolved = policy.evolved[set.id];
  if (project === undefined && user === undefined && evolved !== undefined)
    return { mode: evolved, source: "evolved", ignored: [] };
  if (project === undefined)
    return user === undefined ? fallback(set.id, shadow) : { mode: user, source: "user", ignored: [] };
  if (user === undefined || user === project) return { mode: project, source: "project", ignored: [] };
  return STRENGTH[user] > STRENGTH[project]
    ? { mode: user, source: "user", ignored: [] }
    : { mode: project, source: "project", ignored: [{ source: "user", mode: user }] };
};

export const modeOf = (
  set: Pick<GuardSet, "id" | "damage">,
  policy: Policy,
  shadow: ShadowState,
  arm?: GuardMode,
): GuardMode => resolveGuard(set, policy, shadow, arm).mode;

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

const firesAlert = (decision: HookDecision): boolean =>
  decision.kind === "block" || typeof decision.output?.["systemMessage"] === "string";

const MUTABLE: ReadonlySet<ModeSource> = new Set(["default", "promoted", "evolved"]);

const muted = (
  input: HookInput,
  paths: FmPaths,
  set: GuardSet,
  policy: Policy,
  resolved: GuardResolution,
  shadow: ShadowState,
): boolean => {
  const { runtime } = input;
  const state = recordFiring(runtime, paths, set.id);
  if (!MUTABLE.has(resolved.source)) return false;
  const budget = modeOf(
    { id: ALERT_BUDGET_FEATURE, damage: false },
    policy,
    shadow,
    experimentArm(runtime, paths, policy, ALERT_BUDGET_FEATURE),
  );
  if (budget === "off" || !isMuted(state, policy.alertBudget, nowMs(runtime), set.id)) return false;
  logEvent(runtime, paths, budget === "active" ? "guard_muted" : "guard_mute_shadow", {
    guard: set.id,
    hook: input.event,
    tool: toolName(input.payload),
  });
  return budget === "active";
};

const failOpen =
  (set: GuardSet, handler: HookHandler): HookHandler =>
  async (input): Promise<HookDecision> => {
    try {
      return await handler(input);
    } catch (error) {
      const paths = projectPaths(input);
      if (paths !== undefined) {
        logEvent(input.runtime, paths, "guard_failed_open", {
          guard: set.id,
          hook: input.event,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return { kind: "allow" };
    }
  };

const governed =
  (set: GuardSet, inner: HookHandler): HookHandler =>
  async (input): Promise<HookDecision> => {
    const handler = failOpen(set, inner);
    const paths = projectPaths(input);
    if (paths === undefined) return handler(input);
    if (pausedFor(input.runtime, paths, input.payload.sessionId) !== undefined) return { kind: "allow" };
    const policy = loadPolicy(input.runtime, paths.root);
    const shadow = readShadow(input.runtime, paths);
    const resolved = resolveGuard(set, policy, shadow, experimentArm(input.runtime, paths, policy, set.id));
    if (resolved.mode === "off") {
      if (resolved.source === "experiment" && input.event === "SessionStart")
        logEvent(input.runtime, paths, "experiment_drop", {
          feature: set.id,
          task: readState(input.runtime, paths).active ?? "",
        });
      return { kind: "allow" };
    }
    const decision = await handler(input);
    if (!firesAlert(decision)) return decision;
    if (muted(input, paths, set, policy, resolved, shadow)) return { kind: "allow" };
    if (resolved.mode === "active" || decision.kind !== "block") return decision;
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
