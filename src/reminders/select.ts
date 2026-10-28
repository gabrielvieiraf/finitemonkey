import { globToRegExp } from "../core/glob.js";
import { toPosixPath } from "../core/posix-path.js";
import { tokenEstimate } from "../instructions/types.js";
import type { ProjectRule } from "../rules/types.js";

export const DEFAULT_MAX_RULES = 5;
export const DEFAULT_MAX_TOKENS = 150;
export const SESSION_SOURCES = ["startup", "resume", "compact"] as const;

export type SessionSource = (typeof SESSION_SOURCES)[number];

export type Trigger =
  | { readonly kind: "session"; readonly source: SessionSource }
  | { readonly kind: "subagent" }
  | { readonly kind: "tool"; readonly tool: string; readonly path: string | undefined; readonly command: string }
  | { readonly kind: "prompt"; readonly text: string };

export type Why = "session" | "subagent" | "path" | "tool" | "word" | "violation";

export interface Picked {
  readonly rule: ProjectRule;
  readonly why: Why;
}

export interface Limits {
  readonly maxRules: number;
  readonly maxTokens: number;
}

export interface Selection {
  readonly picked: readonly Picked[];
  readonly text: string;
  readonly tokens: number;
}

const containsWord = (text: string, word: string): boolean =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text);

const pathHit = (rule: ProjectRule, path: string | undefined): boolean =>
  path !== undefined &&
  rule.scope.paths.some((glob) => {
    const pattern = globToRegExp(glob);
    const file = toPosixPath(path);
    return pattern.test(file) || pattern.test(file.slice(file.lastIndexOf("/") + 1));
  });

const scopeWhy = (rule: ProjectRule, trigger: Trigger): Why | undefined => {
  switch (trigger.kind) {
    case "session":
      return "session";
    case "subagent":
      return "subagent";
    case "tool": {
      if (pathHit(rule, trigger.path)) return "path";
      if (rule.scope.paths.length === 0 && rule.scope.tools.includes(trigger.tool)) return "tool";
      return rule.scope.words.some((word) => containsWord(trigger.command, word)) ? "word" : undefined;
    }
    case "prompt":
      return rule.scope.words.some((word) => containsWord(trigger.text, word)) ? "word" : undefined;
  }
};

export const reminderRules = (rules: readonly ProjectRule[]): readonly ProjectRule[] =>
  rules.filter((rule) => rule.bucket === "reminder");

export const lineOf = (rule: ProjectRule): string =>
  `- ${rule.text.replace(/[.\s]+$/, "")}${rule.why === undefined ? "" : ` (${rule.why.replace(/[.\s]+$/, "")})`}.`;

export const HEADER = "finitemonkey reminders, project rules for this step:";

const budgeted = (candidates: readonly Picked[], limits: Limits, counts: Readonly<Record<string, number>>) => {
  const ranked = [...candidates].sort((left, right) => (counts[right.rule.id] ?? 0) - (counts[left.rule.id] ?? 0));
  const kept: Picked[] = [];
  let tokens = tokenEstimate(HEADER);
  for (const item of ranked) {
    const cost = tokenEstimate(lineOf(item.rule)) + 1;
    if (kept.length >= limits.maxRules || tokens + cost > limits.maxTokens) continue;
    kept.push(item);
    tokens += cost;
  }
  return kept.sort((left, right) => (counts[left.rule.id] ?? 0) - (counts[right.rule.id] ?? 0));
};

export const selectReminders = (
  rules: readonly ProjectRule[],
  trigger: Trigger,
  context: {
    readonly counts: Readonly<Record<string, number>>;
    readonly pending: readonly string[];
    readonly seen: ReadonlySet<string>;
    readonly limits: Limits;
  },
): Selection => {
  const fresh = trigger.kind === "session" || trigger.kind === "subagent";
  const candidates = reminderRules(rules).flatMap((rule): readonly Picked[] => {
    if (!fresh && trigger.kind === "prompt" && context.pending.includes(rule.id)) return [{ rule, why: "violation" }];
    if (!fresh && context.seen.has(rule.id)) return [];
    const why = scopeWhy(rule, trigger);
    return why === undefined ? [] : [{ rule, why }];
  });
  const picked = budgeted(candidates, context.limits, context.counts);
  if (picked.length === 0) return { picked, text: "", tokens: 0 };
  const text = [HEADER, ...picked.map((item) => lineOf(item.rule))].join("\n");
  return { picked, text, tokens: tokenEstimate(text) };
};
