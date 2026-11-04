export const PROVIDER_FEATURE = "model-provider";
export const PROVIDER_ENV = "FINITEMONKEY_PROVIDER";
export const PROVIDER_ORIGIN = "model-proposed";
export const DEFAULT_MAX_USD_PER_DAY = 2;

export const PROVIDER_KINDS = [
  "divergence",
  "blind-writer",
  "critic",
  "instruction-conflicts",
  "claim-contradictions",
  "retrieve-deep",
  "concepts",
  "horizon",
  "stance",
  "claim-split",
  "support",
  "distractors",
  "agent",
  "code-concepts",
  "negative-test",
  "teach-input",
  "journey",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export type Workdir = "none" | "project" | "worktree";

export interface KindSpec {
  readonly tools: readonly string[];
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly defaultUsd: number;
  readonly workdir: Workdir;
}

const READ_ONLY = ["Read", "Glob", "Grep"] as const;
const EDITS = [...READ_ONLY, "Edit", "Write"] as const;
const MINUTE = 60_000;

const answer = (defaultUsd: number): KindSpec => ({
  tools: [],
  maxTurns: 1,
  timeoutMs: 2 * MINUTE,
  defaultUsd,
  workdir: "none",
});

export const KIND_SPECS: Readonly<Record<ProviderKind, KindSpec>> = {
  divergence: { tools: EDITS, maxTurns: 30, timeoutMs: 15 * MINUTE, defaultUsd: 0.5, workdir: "worktree" },
  "blind-writer": { tools: READ_ONLY, maxTurns: 15, timeoutMs: 15 * MINUTE, defaultUsd: 0.3, workdir: "worktree" },
  critic: { tools: ["Read"], maxTurns: 3, timeoutMs: 5 * MINUTE, defaultUsd: 0.05, workdir: "project" },
  "instruction-conflicts": answer(0.03),
  "claim-contradictions": answer(0.02),
  "retrieve-deep": { tools: READ_ONLY, maxTurns: 8, timeoutMs: 5 * MINUTE, defaultUsd: 0.1, workdir: "project" },
  concepts: answer(0.02),
  horizon: answer(0.02),
  stance: answer(0.02),
  "claim-split": answer(0.02),
  support: answer(0.02),
  distractors: answer(0.02),
  agent: { tools: [...EDITS, "Bash"], maxTurns: 60, timeoutMs: 60 * MINUTE, defaultUsd: 2, workdir: "project" },
  "code-concepts": answer(0.02),
  "negative-test": answer(0.05),
  "teach-input": answer(0.02),
  journey: answer(0.03),
};

export const parseKind = (value: string | undefined): ProviderKind | undefined =>
  PROVIDER_KINDS.find((kind) => kind === value);
