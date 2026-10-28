import type { AbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import type { Candidate } from "./discover.js";

export const DEFAULT_COMMAND_TIMEOUT_S = 120;
export const TOTAL_BUDGET_MS = 10 * 60_000;
const UNSAFE = /\b(?:deploy|publish|release|push|upload|migrate|seed|start|dev|serve|watch|install)\b|\bnpm ci\b/;

export type Outcome = "passed" | "failed" | "timeout" | "missing" | "skipped" | "not_run";

export interface Ran extends Candidate {
  readonly outcome: Outcome;
  readonly exitCode: number | null;
}

const runOne = (runtime: Runtime, root: AbsolutePath, candidate: Candidate, timeoutMs: number): Ran => {
  const result = runtime.exec({
    command: candidate.run,
    args: [],
    cwd: root,
    shell: true,
    timeoutMs,
    env: { CI: "1" },
  });
  const outcome: Outcome = !result.found
    ? "missing"
    : result.timedOut
      ? "timeout"
      : result.exitCode === 0
        ? "passed"
        : "failed";
  return { ...candidate, outcome, exitCode: result.exitCode };
};

export const runCandidates = (
  runtime: Runtime,
  root: AbsolutePath,
  candidates: readonly Candidate[],
  timeoutS: number,
): readonly Ran[] => {
  const deadline = nowMs(runtime) + TOTAL_BUDGET_MS;
  return candidates.map((candidate): Ran => {
    if (UNSAFE.test(candidate.run)) return { ...candidate, outcome: "skipped", exitCode: null };
    const left = deadline - nowMs(runtime);
    if (left <= 0) return { ...candidate, outcome: "not_run", exitCode: null };
    return runOne(runtime, root, candidate, Math.min(left, timeoutS * 1000));
  });
};
