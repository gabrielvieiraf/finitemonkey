import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import type { JsonObject } from "../../core/parsed.js";
import type { HookDecision, HookInput } from "../../hooks/handlers.js";
import { type FmPaths, fmPaths } from "../../task/paths.js";

export const DEFAULT_GATE_BUDGET_MS = 300_000;
export const DEADLINE_MARGIN_MS = 20_000;

export const sessionCwd = (input: HookInput): AbsolutePath =>
  input.payload.cwd === undefined ? input.cwd : toAbsolutePath(input.payload.cwd, input.cwd);

const MAX_DEPTH = 64;

export const findRepoRoot = (runtime: HookInput["runtime"], start: AbsolutePath): AbsolutePath | undefined => {
  let current = start;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (runtime.stat(toAbsolutePath(join(current, ".git"))) !== undefined) return current;
    const parent = toAbsolutePath(dirname(current));
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
};

export const projectPaths = (input: HookInput): FmPaths | undefined => {
  const root = findRepoRoot(input.runtime, sessionCwd(input));
  return root === undefined ? undefined : fmPaths(root);
};

export const gateBudget = (input: HookInput): number => {
  const parsed = Number.parseInt(input.env["FINITEMONKEY_GATE_BUDGET_MS"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GATE_BUDGET_MS;
};

export const allowWith = (output: JsonObject): HookDecision => ({ kind: "allow", output });

export const contextOutput = (event: string, additionalContext: string, systemMessage?: string): JsonObject => ({
  hookSpecificOutput: { hookEventName: event, additionalContext },
  ...(systemMessage === undefined ? {} : { systemMessage }),
});

export const human = (text: string): string => `finitemonkey: ${text}`;
