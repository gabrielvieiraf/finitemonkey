import type { CommandSpec } from "./types.js";

export const OVERVIEW_EXAMPLES: readonly string[] = [
  "finitemonkey init",
  "finitemonkey doctor",
  "finitemonkey gate --json",
  "finitemonkey help gate",
];

const withoutOptional = (usage: string): string => {
  let depth = 0;
  let kept = "";
  for (const char of usage) {
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) kept += char;
  }
  return kept;
};

export const examplesOf = (spec: Pick<CommandSpec, "usage" | "examples">): readonly string[] => {
  if (spec.examples !== undefined && spec.examples.length > 0) return spec.examples;
  const usage = spec.usage.replace(/\s*\([^)]*\)\s*$/, "");
  const base = withoutOptional(usage).replace(/\s+/g, " ").trim();
  const json = /--json\b/.test(usage) && !/--json\b/.test(base) ? [`${base} --json`] : [];
  return [base, ...json];
};

export const exampleLines = (title: string, examples: readonly string[]): readonly string[] =>
  examples.length === 0 ? [] : ["", `${title}:`, ...examples.map((example) => `  $ ${example}`)];
