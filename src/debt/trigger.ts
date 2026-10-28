import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configMap, loadProjectConfig } from "../git/project-config.js";

export type TriggerState = "no-trigger" | "expired" | "waiting" | "unreadable";

export interface TriggerResult {
  readonly state: TriggerState;
  readonly detail: string;
}

const DATE = /^date:\s*(\d{4}-\d{2}-\d{2})$/i;
const COUNT = /^count:\s*([A-Za-z0-9_-]+)\s*(>=|>)\s*(\d+)$/i;
const TIMEOUT_MS = 10_000;

const countOf = (runtime: Runtime, root: AbsolutePath, command: string): number | undefined => {
  const run = runtime.exec({ command, args: [], cwd: root, timeoutMs: TIMEOUT_MS, shell: true });
  const value = run.exitCode === 0 ? /-?\d+/.exec(run.stdout)?.[0] : undefined;
  return value === undefined ? undefined : Number(value);
};

export const evaluateTrigger = (runtime: Runtime, root: AbsolutePath, trigger: string | undefined): TriggerResult => {
  if (trigger === undefined || trigger.trim() === "") return { state: "no-trigger", detail: "" };
  const date = DATE.exec(trigger.trim());
  if (date?.[1] !== undefined)
    return { state: runtime.now().slice(0, 10) >= date[1] ? "expired" : "waiting", detail: date[1] };
  const count = COUNT.exec(trigger.trim());
  if (count?.[1] === undefined || count[3] === undefined) return { state: "unreadable", detail: trigger };
  const command = configMap(loadProjectConfig(runtime, root), "debt", "counts")[count[1]];
  if (command === undefined) return { state: "unreadable", detail: `debt.counts.${count[1]}` };
  const value = countOf(runtime, root, command);
  if (value === undefined) return { state: "unreadable", detail: command };
  const limit = Number(count[3]);
  const over = count[2] === ">=" ? value >= limit : value > limit;
  return {
    state: over ? "expired" : "waiting",
    detail: `${count[1]} = ${String(value)} (${count[2] ?? ">"} ${String(limit)})`,
  };
};
