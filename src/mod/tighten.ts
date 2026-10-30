import type { CompiledRule, LoadedState } from "./state.js";

export type Decision = "allow" | "ask" | "deny";

export interface CheckResult {
  readonly decision: Decision;
  readonly reason?: string;
}

const FILE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (input: unknown, ...names: readonly string[]): string | undefined => {
  if (!isRecord(input)) return undefined;
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
};

const posix = (path: string): string => path.replaceAll("\\", "/");

export const relativeTo = (root: string, path: string): string => {
  const base = posix(root).replace(/\/+$/, "");
  const full = posix(path);
  const sameCase = /^[A-Za-z]:\//.test(base) ? full.toLowerCase().startsWith(`${base.toLowerCase()}/`) : false;
  if (full.startsWith(`${base}/`) || sameCase) return full.slice(base.length + 1);
  return full.replace(/^\.\//, "");
};

const firstMatch = (rules: readonly CompiledRule[], value: string): CompiledRule | undefined =>
  rules.find((rule) => rule.regex.test(value));

export const ruleFor = (state: LoadedState, tool: string, input: unknown): CompiledRule | undefined => {
  if (FILE_TOOLS.has(tool)) {
    const path = text(input, "file_path", "notebook_path");
    if (path === undefined) return undefined;
    const rules = state.rules.filter((rule) => rule.rule.target === "path");
    return firstMatch(rules, relativeTo(state.root, path));
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = text(input, "command");
    if (command === undefined) return undefined;
    return firstMatch(
      state.rules.filter((rule) => rule.rule.target === "command"),
      command,
    );
  }
  return undefined;
};

const RANK: Readonly<Record<Decision, number>> = { allow: 0, ask: 1, deny: 2 };

export const stricter = (decided: CheckResult, tightened: CheckResult): CheckResult =>
  RANK[tightened.decision] > RANK[decided.decision] ? tightened : decided;

export const tightenFor = (rule: CompiledRule): CheckResult => ({
  decision: "deny",
  reason: rule.rule.reason,
});

export const FAILED_REASON =
  "finitemonkey: the mod's permission check failed, so this call was refused. Retry it; the command hooks still decide it.";
