import { JUDGE_GUARDS } from "./judge-guards.js";
import type { GuardMode, Level } from "./policy.js";

export const ACTIVE_AT_STANDARD: ReadonlySet<string> = new Set([
  "guardian-reuse",
  "quality",
  "slop",
  "quality-detectors",
  "syntax-check",
  "callers-syntax",
  "clarify",
  "premise-check",
  "divergence-ask",
  "decision-hold",
  "early-loops",
  "fourth-attempt",
  "assumptions",
  "reality",
  "proportionality",
  "tests-hold",
  "regression",
  "red-green",
  "test-pin",
  "teach-back",
  "xray",
  "probes",
  "predict-gate",
  "explain-approval",
  "secret-context",
  "untrusted-outward",
  "bash-writes",
  "migrate-check",
  ...JUDGE_GUARDS,
]);

export const levelMode = (id: string, level: Level): GuardMode =>
  level === "strict" || (level === "standard" && ACTIVE_AT_STANDARD.has(id)) ? "active" : "shadow";
