import type { ModApi } from "./api.js";
import { runCli } from "./cli.js";
import type { StreamNext, TurnStepInput, TurnStepResult } from "./events.js";
import { count as num, label } from "./labels.js";
import { memory, type StepUsage } from "./memory.js";

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export const usageOf = (result: TurnStepResult, agent: string | undefined): StepUsage | undefined => {
  const usage = result.usage;
  if (usage === undefined || usage === null) return undefined;
  return {
    model: typeof usage.model === "string" ? usage.model : "unknown",
    agent: agent ?? null,
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
  };
};

export async function* stepUsage(
  _$: ModApi,
  e: TurnStepInput,
  next: StreamNext,
): AsyncGenerator<unknown, TurnStepResult, unknown> {
  const result = yield* next(e);
  const step = usageOf(result, e.agentId);
  if (step !== undefined) memory.steps = [...memory.steps, step];
  return result;
}

async function flushUsage($: ModApi, steps: readonly StepUsage[]): Promise<void> {
  await runCli($, ["mod", "usage", "--steps", JSON.stringify(steps)]);
}

export function scheduleUsage($: ModApi): void {
  const steps = memory.steps;
  if (steps.length === 0) return;
  memory.steps = [];
  $.clock.after(0, () => flushUsage($, steps));
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const money = (usd: unknown): string => `$${(typeof usd === "number" ? usd : 0).toFixed(2)}`;

const splitLines = (data: Readonly<Record<string, unknown>>): readonly string[] => {
  const build = data["build"];
  const verification = data["verification"];
  if (!isRecord(build) || !isRecord(verification)) return [];
  const minutes = typeof verification["gateMinutes"] === "number" ? verification["gateMinutes"] : 0;
  return [
    label("mod.view.split", {
      build: money(build["usd"]),
      verification: money(verification["usd"]),
      minutes,
    }),
  ];
};

const tally = (value: unknown): number => (typeof value === "number" ? value : 0);

const tokenLines = (data: Readonly<Record<string, unknown>>): readonly string[] => {
  const tokens = isRecord(data["tokens"]) ? data["tokens"] : {};
  return [
    label("mod.view.cost_contract_tokens", {
      task: String(data["task"]),
      tokens: num(tally(tokens["total"])),
      requests: tally(data["requests"]),
    }),
    label("mod.view.cost_token_split", {
      input: num(tally(tokens["input"])),
      output: num(tally(tokens["output"])),
      cacheRead: num(tally(tokens["cacheRead"])),
      cacheWrite: num(tally(tokens["cacheWrite"])),
    }),
  ];
};

const usdLines = (data: Readonly<Record<string, unknown>>): readonly string[] => {
  const arms = Array.isArray(data["byArm"]) ? data["byArm"].filter(isRecord) : [];
  return [
    label("mod.view.cost_contract_usd", {
      task: String(data["task"]),
      usd: money(data["usd"]),
      requests: tally(data["requests"]),
    }),
    label("mod.view.attempts", {
      attempts: tally(data["attempts"]),
      perAttempt: data["perAttempt"] === null ? "-" : money(data["perAttempt"]),
    }),
    ...splitLines(data),
    ...arms.map((arm) =>
      label("mod.view.arm", { arm: String(arm["arm"]), usd: money(arm["usd"]), requests: tally(arm["requests"]) }),
    ),
  ];
};

export const costLines = (text: string): readonly string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== "finitemonkey/mod-cost@1") return [];
  return data["billing"] === "subscription" ? tokenLines(data) : usdLines(data);
};

export async function refreshCost($: ModApi): Promise<readonly string[]> {
  const text = await runCli($, ["mod", "cost", "--json"]);
  memory.cost = text === undefined ? [] : costLines(text);
  return memory.cost;
}
