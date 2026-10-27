export const CHECK_KINDS = [
  "command",
  "tests",
  "diff",
  "placeholders",
  "git",
  "pr",
  "manual",
  "look",
  "runtime",
  "callers",
  "secrets",
  "worktree",
  "merge",
  "prod",
  "prose",
  "review",
  "inventory",
  "plan",
  "decision",
  "research",
  "cost",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export const GIT_REQUIREMENTS = ["committed", "pushed", "pr_open"] as const;

export type GitRequirement = (typeof GIT_REQUIREMENTS)[number];

export const SIZES = ["S", "M", "L"] as const;

export type TaskSize = (typeof SIZES)[number];

export interface AcceptanceCheck {
  readonly id: string;
  readonly kind: CheckKind;
  readonly run?: string;
  readonly timeoutS?: number;
  readonly require?: readonly GitRequirement[];
  readonly requireOpen?: boolean;
  readonly description?: string;
  readonly port?: number;
  readonly route?: string;
  readonly status?: number;
  readonly body?: string;
}

export interface DiffBudget {
  readonly files?: number;
  readonly lines?: number;
}

export interface TaskScope {
  readonly paths: readonly string[];
  readonly diffBudget?: DiffBudget;
  readonly testsProtected: boolean;
}

export interface TaskContract {
  readonly id: string;
  readonly goal: string;
  readonly size: TaskSize;
  readonly base?: string;
  readonly scope: TaskScope;
  readonly acceptance: readonly AcceptanceCheck[];
  readonly decisionsNeeded: readonly string[];
  readonly callersIgnore?: readonly string[];
  readonly implicit: boolean;
}

export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const TASK_SCHEMA = "finitemonkey/task@1";
