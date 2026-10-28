import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";
import { DEFAULT_STOP_AFTER } from "./attempts.js";

export const DEFAULT_HYPOTHESIS_CHARS = 20;

const positive = (raw: unknown, fallback: number, minimum: number): number => {
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

export interface SignalLimits {
  readonly stopAfter: number;
  readonly hypothesisChars: number;
}

export const signalLimits = (runtime: Runtime, root: AbsolutePath): SignalLimits => {
  const config = loadProjectConfig(runtime, root);
  return {
    stopAfter: positive(configAt(config, "signals", "stop_after"), DEFAULT_STOP_AFTER, 2),
    hypothesisChars: positive(configAt(config, "signals", "hypothesis_chars"), DEFAULT_HYPOTHESIS_CHARS, 1),
  };
};
