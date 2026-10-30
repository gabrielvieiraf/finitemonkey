import type { ModApi } from "./api.js";
import { runCli } from "./cli.js";
import type { StreamNext, TurnStepInput, TurnStepResult } from "./events.js";
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

export const costLines = (text: string): readonly string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== "finitemonkey/mod-cost@1") return [];
  const arms = Array.isArray(data["byArm"]) ? data["byArm"].filter(isRecord) : [];
  return [
    `contract ${String(data["task"])}: ${money(data["usd"])} in ${String(data["requests"])} requests`,
    `attempts ${String(data["attempts"])} · per attempt ${data["perAttempt"] === null ? "-" : money(data["perAttempt"])}`,
    ...arms.map((arm) => `arm ${String(arm["arm"])}: ${money(arm["usd"])} in ${String(arm["requests"])} requests`),
  ];
};

export async function refreshCost($: ModApi): Promise<readonly string[]> {
  const text = await runCli($, ["mod", "cost", "--json"]);
  memory.cost = text === undefined ? [] : costLines(text);
  return memory.cost;
}
