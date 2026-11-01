import type { AbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, type JsonObject, parseJson, parseJsonObject } from "../core/parsed.js";
import type { ExecResult, Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { KIND_SPECS, PROVIDER_ENV, PROVIDER_FEATURE, PROVIDER_ORIGIN, type ProviderKind } from "./kinds.js";
import { recordUsage, spentToday, usageOf } from "./ledger.js";
import { type PromptId, PROMPTS } from "./prompts.js";
import { isEnabled, maxUsdPerDay, proposalsFile } from "./store.js";

export interface ProviderDeps {
  readonly runtime: Runtime;
  readonly paths: FmPaths;
  readonly env: Env;
  readonly task?: string;
}

export interface ProviderRequest<T> {
  readonly kind: ProviderKind;
  readonly prompt?: PromptId;
  readonly payload: JsonObject;
  readonly cwd?: AbsolutePath;
  readonly validate: (value: unknown) => T | undefined;
}

export type Outcome<T> =
  | { readonly status: "off" | "nested" | "failed" | "invalid" }
  | { readonly status: "capped"; readonly spent: number; readonly cap: number }
  | { readonly status: "shadow" | "ok"; readonly value: T };

const unfence = (text: string): string => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced?.[1] ?? text).trim();
};

export const answerOf = (result: string): unknown => {
  const text = unfence(result);
  const direct = parseJson(text);
  if (direct.ok) return direct.value;
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (start < 0 || end <= start) return undefined;
  const sliced = parseJson(text.slice(start, end + 1));
  return sliced.ok ? sliced.value : undefined;
};

const argsOf = (kind: ProviderKind, prompt: string, budget: number): readonly string[] => {
  const spec = KIND_SPECS[kind];
  const edits = spec.tools.includes("Edit");
  return [
    "--print",
    prompt,
    "--output-format",
    "json",
    "--max-turns",
    String(spec.maxTurns),
    "--max-budget-usd",
    budget.toFixed(2),
    "--no-session-persistence",
    "--tools",
    spec.tools.join(","),
    ...(spec.tools.length > 0 ? ["--allowed-tools", spec.tools.join(",")] : []),
    ...(edits ? ["--permission-mode", "acceptEdits"] : []),
  ];
};

const run = (deps: ProviderDeps, request: ProviderRequest<unknown>, budget: number): ExecResult =>
  deps.runtime.exec({
    command: "claude",
    args: argsOf(request.kind, PROMPTS[request.prompt ?? request.kind], budget),
    cwd: request.cwd ?? deps.paths.root,
    timeoutMs: KIND_SPECS[request.kind].timeoutMs,
    env: { [PROVIDER_ENV]: request.kind },
    unset: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
    input: JSON.stringify(request.payload),
  });

export const taskOf = (deps: ProviderDeps): string =>
  deps.task ?? readState(deps.runtime, deps.paths).active ?? "implicit";

const items = (value: unknown): number => (Array.isArray(value) ? value.length : value === undefined ? 0 : 1);

const propose = (deps: ProviderDeps, kind: ProviderKind, mode: string, value: unknown): void => {
  const line = { at: deps.runtime.now(), kind, task: taskOf(deps), origin: PROVIDER_ORIGIN, mode, items: items(value) };
  deps.runtime.appendText(proposalsFile(deps.paths), `${JSON.stringify(line)}\n`);
};

const gate = (deps: ProviderDeps, kind: ProviderKind): Outcome<never> | undefined => {
  if (!isEnabled(deps.runtime, deps.paths, kind)) return { status: "off" };
  if (featureMode(deps.runtime, deps.paths, PROVIDER_FEATURE) === "off") return { status: "off" };
  if (deps.env[PROVIDER_ENV] !== undefined) return { status: "nested" };
  const cap = maxUsdPerDay(deps.runtime, deps.paths);
  const spent = spentToday(deps.runtime, deps.paths);
  if (spent < cap) return undefined;
  logEvent(deps.runtime, deps.paths, "provider.capped", { kind, spent, cap });
  return { status: "capped", spent, cap };
};

const envelopeOf = (result: ExecResult): JsonObject | undefined => {
  if (!result.found || result.timedOut) return undefined;
  const parsed = parseJsonObject(result.stdout.trim());
  return parsed.ok ? parsed.value : undefined;
};

export const callProvider = <T>(deps: ProviderDeps, request: ProviderRequest<T>): Outcome<T> => {
  const blocked = gate(deps, request.kind);
  if (blocked !== undefined) return blocked;
  const budget = maxUsdPerDay(deps.runtime, deps.paths) - spentToday(deps.runtime, deps.paths);
  const envelope = envelopeOf(run(deps, request, budget));
  const task = taskOf(deps);
  if (envelope !== undefined)
    recordUsage(deps.runtime, deps.paths, { kind: request.kind, task, usage: usageOf(envelope) });
  const result = envelope?.["result"];
  if (envelope === undefined || envelope["is_error"] === true || typeof result !== "string") {
    logEvent(deps.runtime, deps.paths, "provider.failed", { kind: request.kind, task });
    return { status: "failed" };
  }
  const value = request.validate(answerOf(result));
  if (value === undefined) {
    logEvent(deps.runtime, deps.paths, "provider.invalid", { kind: request.kind, task });
    return { status: "invalid" };
  }
  const mode = featureMode(deps.runtime, deps.paths, PROVIDER_FEATURE);
  propose(deps, request.kind, mode, value);
  if (mode === "active") return { status: "ok", value };
  recordFeatureShadow(deps.runtime, deps.paths, PROVIDER_FEATURE, { kind: request.kind, task });
  return { status: "shadow", value };
};

export const valueOf = <T>(outcome: Outcome<T>): T | undefined => (outcome.status === "ok" ? outcome.value : undefined);

export const isRecordList = (value: unknown): value is readonly JsonObject[] =>
  Array.isArray(value) && value.every(isRecord);
