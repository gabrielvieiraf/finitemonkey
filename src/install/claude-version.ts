import type { Runtime } from "../core/runtime.js";

export const ON_FAILURE_MIN = [2, 1, 295] as const;

const PROBE_MS = 8000;

export const parseClaudeVersion = (output: string): readonly number[] | undefined => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
};

const atLeast = (version: readonly number[], min: readonly number[]): boolean => {
  for (const [index, part] of min.entries()) {
    const value = version[index] ?? 0;
    if (value !== part) return value > part;
  }
  return true;
};

export interface ClaudeInfo {
  readonly version: string | undefined;
  readonly failClosed: boolean;
}

export const detectClaude = (probe: Runtime["probe"]): ClaudeInfo => {
  const result = probe("claude", ["--version"], PROBE_MS);
  const parsed = result.ok ? parseClaudeVersion(result.stdout) : undefined;
  if (parsed === undefined) return { version: undefined, failClosed: true };
  return { version: parsed.join("."), failClosed: atLeast(parsed, ON_FAILURE_MIN) };
};
