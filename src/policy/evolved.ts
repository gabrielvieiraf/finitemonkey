import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { armOf } from "./experiment.js";
import type { GuardMode, Policy } from "./policy.js";

export const EVOLVE_FEATURE = "evolve";
export const EVOLVE_FILE = "evolve.json";
export const VARIANT_STATUSES = ["trial", "promoted", "rejected", "reverted"] as const;

export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export type VariantChange =
  | { readonly kind: "guard"; readonly guard: string; readonly mode: GuardMode }
  | { readonly kind: "alertBudget"; readonly key: "muteAbove"; readonly value: number }
  | { readonly kind: "reminder"; readonly rule: string; readonly include: boolean };

export const REMINDER_KEY_PREFIX = "reminder:";
export const SIGNIFICANCE_TEST = "welch95";

export interface ArmRecord {
  readonly arm: "active" | "off";
  readonly mode: GuardMode;
}

export interface ArmSummary {
  readonly tasks: readonly string[];
  readonly falseDone: number;
  readonly dismissals: number;
  readonly medianWallMs: number;
}

export type Interval = readonly [number, number];

export interface SignificanceResult {
  readonly name: typeof SIGNIFICANCE_TEST;
  readonly passed: boolean;
  readonly intervals: Readonly<Record<string, Interval | null>>;
}

export interface VariantEvidence {
  readonly variant: ArmSummary;
  readonly parent: ArmSummary;
  readonly evaluator: string;
  readonly test?: SignificanceResult;
}

export interface Variant {
  readonly id: string;
  readonly change: VariantChange;
  readonly reason: string;
  readonly bornTask: string | null;
  readonly parent?: string;
  readonly bornAt: string;
  readonly evaluator: string;
  readonly status: VariantStatus;
  readonly decidedAt?: string;
  readonly evidence?: VariantEvidence;
  readonly tasks: Readonly<Record<string, ArmRecord>>;
}

export interface EvolveState {
  readonly variants: readonly Variant[];
  readonly unseen: readonly string[];
}

const GUARD_MODE_VALUES: readonly GuardMode[] = ["off", "shadow", "active"];

const str = (raw: JsonObject, key: string): string | undefined => {
  const value = raw[key];
  return typeof value === "string" ? value : undefined;
};

const modeOf = (value: unknown): GuardMode | undefined => GUARD_MODE_VALUES.find((mode) => mode === value);

const changeOf = (value: unknown): VariantChange | undefined => {
  if (!isRecord(value)) return undefined;
  const mode = modeOf(value["mode"]);
  if (value["kind"] === "guard" && typeof value["guard"] === "string" && mode !== undefined)
    return { kind: "guard", guard: value["guard"], mode };
  const amount = value["value"];
  if (value["kind"] === "alertBudget" && value["key"] === "muteAbove" && typeof amount === "number")
    return { kind: "alertBudget", key: "muteAbove", value: amount };
  if (value["kind"] === "reminder" && typeof value["rule"] === "string" && typeof value["include"] === "boolean")
    return { kind: "reminder", rule: value["rule"], include: value["include"] };
  return undefined;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const summaryOf = (value: unknown): ArmSummary | undefined => {
  if (!isRecord(value)) return undefined;
  const { falseDone, dismissals, medianWallMs } = value;
  if (typeof falseDone !== "number" || typeof dismissals !== "number" || typeof medianWallMs !== "number")
    return undefined;
  return { tasks: strings(value["tasks"]), falseDone, dismissals, medianWallMs };
};

const intervalOf = (value: unknown): Interval | null =>
  Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number")
    ? [Number(value[0]), Number(value[1])]
    : null;

const testOf = (value: unknown): SignificanceResult | undefined => {
  if (!isRecord(value) || value["name"] !== SIGNIFICANCE_TEST || typeof value["passed"] !== "boolean") return undefined;
  const raw = isRecord(value["intervals"]) ? value["intervals"] : {};
  const intervals = Object.fromEntries(Object.entries(raw).map(([metric, item]) => [metric, intervalOf(item)]));
  return { name: SIGNIFICANCE_TEST, passed: value["passed"], intervals };
};

const evidenceOf = (value: unknown): VariantEvidence | undefined => {
  if (!isRecord(value) || typeof value["evaluator"] !== "string") return undefined;
  const variant = summaryOf(value["variant"]);
  const parent = summaryOf(value["parent"]);
  const test = testOf(value["test"]);
  if (variant === undefined || parent === undefined) return undefined;
  return { variant, parent, evaluator: value["evaluator"], ...(test === undefined ? {} : { test }) };
};

const armsOf = (value: unknown): Readonly<Record<string, ArmRecord>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([task, raw]): [string, ArmRecord][] => {
          if (!isRecord(raw)) return [];
          const mode = modeOf(raw["mode"]);
          const arm = raw["arm"] === "active" || raw["arm"] === "off" ? raw["arm"] : undefined;
          return mode === undefined || arm === undefined ? [] : [[task, { arm, mode }]];
        }),
      )
    : {};

const variantOf = (raw: unknown): Variant | undefined => {
  if (!isRecord(raw)) return undefined;
  const id = str(raw, "id");
  const change = changeOf(raw["change"]);
  const bornAt = str(raw, "bornAt");
  const evaluator = str(raw, "evaluator");
  const status = VARIANT_STATUSES.find((item) => item === raw["status"]);
  if (id === undefined || change === undefined || bornAt === undefined || evaluator === undefined) return undefined;
  if (status === undefined) return undefined;
  const decidedAt = str(raw, "decidedAt");
  const evidence = evidenceOf(raw["evidence"]);
  const parent = str(raw, "parent");
  return {
    id,
    change,
    reason: str(raw, "reason") ?? "",
    bornTask: str(raw, "bornTask") ?? null,
    ...(parent === undefined ? {} : { parent }),
    bornAt,
    evaluator,
    status,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(evidence === undefined ? {} : { evidence }),
    tasks: armsOf(raw["tasks"]),
  };
};

export const evolvePath = (root: AbsolutePath): AbsolutePath =>
  toAbsolutePath(join(root, DATA_DIR, "cache", EVOLVE_FILE));

export const EMPTY_EVOLVE: EvolveState = { variants: [], unseen: [] };

export const readEvolve = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): EvolveState => {
  const text = runtime.readText(evolvePath(root));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return EMPTY_EVOLVE;
  const raw = parsed.value["variants"];
  return {
    variants: Array.isArray(raw) ? raw.flatMap((item: unknown) => variantOf(item) ?? []) : [],
    unseen: strings(parsed.value["unseen"]),
  };
};

export const writeEvolve = (runtime: Pick<Runtime, "writeText">, root: AbsolutePath, state: EvolveState): void => {
  runtime.writeText(evolvePath(root), `${JSON.stringify(state, null, 2)}\n`);
};

export const variantArm = (task: string, id: string): "active" | "off" => armOf(task, `evolve:${id}`);

const STRENGTH: Readonly<Record<GuardMode, number>> = { off: 0, shadow: 1, active: 2 };

const activeTaskOf = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): string | undefined => {
  const text = runtime.readText(toAbsolutePath(join(root, DATA_DIR, "state.json")));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const active = parsed?.ok === true ? parsed.value["active"] : undefined;
  return typeof active === "string" ? active : undefined;
};

export const evolveModeOf = (policy: Policy, task: string | undefined): GuardMode => {
  if (policy.experiments[EVOLVE_FEATURE] === "random" && task !== undefined) return armOf(task, EVOLVE_FEATURE);
  const project = policy.guards[EVOLVE_FEATURE];
  const user = policy.userGuards[EVOLVE_FEATURE];
  if (project === undefined) return user ?? "shadow";
  return user !== undefined && STRENGTH[user] > STRENGTH[project] ? user : project;
};

export const appliesTo = (variant: Variant, task: string | undefined): boolean => {
  if (variant.status === "promoted") return true;
  if (variant.status !== "trial" || task === undefined || task === variant.bornTask) return false;
  return variantArm(task, variant.id) === "active";
};

const applyChange = (policy: Policy, change: VariantChange): Policy => {
  if (change.kind === "guard") return { ...policy, evolved: { ...policy.evolved, [change.guard]: change.mode } };
  if (change.kind === "reminder")
    return {
      ...policy,
      evolved: { ...policy.evolved, [`${REMINDER_KEY_PREFIX}${change.rule}`]: change.include ? "active" : "off" },
    };
  if (policy.alertBudgetSet.includes(change.key)) return policy;
  return { ...policy, alertBudget: { ...policy.alertBudget, [change.key]: change.value } };
};

export const withEvolved = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, policy: Policy): Policy => {
  const state = readEvolve(runtime, root);
  const live = state.variants.filter((variant) => variant.status === "promoted" || variant.status === "trial");
  if (live.length === 0) return policy;
  const task = activeTaskOf(runtime, root);
  if (evolveModeOf(policy, task) !== "active") return policy;
  return live
    .filter((variant) => appliesTo(variant, task))
    .reduce((next, variant) => applyChange(next, variant.change), policy);
};

export const trialFor = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  policy: Policy,
): Variant | undefined => {
  const task = activeTaskOf(runtime, root);
  if (evolveModeOf(policy, task) !== "active") return undefined;
  return readEvolve(runtime, root).variants.find((variant) => variant.status === "trial" && appliesTo(variant, task));
};

export const excludedReminders = (policy: Policy): ReadonlySet<string> =>
  new Set(
    Object.entries(policy.evolved).flatMap(([key, mode]) =>
      key.startsWith(REMINDER_KEY_PREFIX) && mode === "off" ? [key.slice(REMINDER_KEY_PREFIX.length)] : [],
    ),
  );
