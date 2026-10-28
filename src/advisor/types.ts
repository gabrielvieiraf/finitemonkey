export const ADVISOR_GUARD = "advisor";
export const SUGGESTIONS_FILE = ".finitemonkey/suggestions.jsonl";
export const MAX_SUGGESTIONS = 3;
export const PERSON_MUTE_AFTER = 3;
export const RETIRE_RATE = 0.1;
export const RETIRE_MIN_SHOWN = 10;

export const ADVISOR_RULES = [
  "complex_function",
  "deep_nesting",
  "long_function",
  "long_parameter_list",
  "large_module",
  "message_chain",
  "busy_statement",
] as const;

export type AdvisorRule = (typeof ADVISOR_RULES)[number];

export const REFACTORINGS: Readonly<Record<AdvisorRule, string>> = {
  complex_function: "Decompose Conditional",
  deep_nesting: "Replace Nested Conditional with Guard Clauses",
  long_function: "Extract Function",
  long_parameter_list: "Introduce Parameter Object",
  large_module: "Move Function",
  message_chain: "Hide Delegate",
  busy_statement: "Extract Variable",
};

export const SUGGESTION_STATES = ["open", "accepted", "dismissed", "closed"] as const;

export type SuggestionState = (typeof SUGGESTION_STATES)[number];

export interface CommandRun {
  readonly command: string;
  readonly exitCode: number | null;
}

export interface Suggestion {
  readonly id: string;
  readonly at: string;
  readonly task: string;
  readonly rule: AdvisorRule;
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly metric: string;
  readonly value: number;
  readonly target: number;
  readonly refactoring: string;
  readonly example?: string;
  readonly score: number;
  readonly state: SuggestionState;
  readonly by?: string;
  readonly refactorTask?: string;
  readonly before?: readonly CommandRun[];
  readonly after?: number;
}

export const isRule = (value: unknown): value is AdvisorRule =>
  typeof value === "string" && (ADVISOR_RULES as readonly string[]).includes(value);

export const isState = (value: unknown): value is SuggestionState =>
  typeof value === "string" && (SUGGESTION_STATES as readonly string[]).includes(value);
