import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { compareOutput, type GoldenDifference } from "./compare.js";

export const GOLDEN_FEATURE = "golden";
export const GOLDEN_DIR = ".finitemonkey/golden";
export const CASE_PLACEHOLDER = "{case}";
export const DEFAULT_CASE_TIMEOUT_MS = 60_000;
const CASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface GoldenSpec {
  readonly id: string;
  readonly run: string;
  readonly cases: string;
  readonly tolerance: number;
}

export type CaseResult =
  | { readonly name: string; readonly kind: "match"; readonly stdout: string }
  | { readonly name: string; readonly kind: "missing"; readonly stdout: string }
  | { readonly name: string; readonly kind: "exit"; readonly exitCode: number | null }
  | { readonly name: string; readonly kind: "diff"; readonly stdout: string; readonly difference: GoldenDifference };

export const expectedPath = (root: AbsolutePath, checkId: string, name: string): AbsolutePath =>
  toAbsolutePath(join(root, GOLDEN_DIR, checkId, `${name}.out`));

export const historyPath = (root: AbsolutePath, checkId: string): AbsolutePath =>
  toAbsolutePath(join(root, GOLDEN_DIR, checkId, "accepted.jsonl"));

export const listCases = (runtime: Pick<Runtime, "listDir">, root: AbsolutePath, cases: string): readonly string[] => {
  const listed = runtime.listDir(toAbsolutePath(join(root, cases)));
  return listed.ok ? listed.value.filter((name) => CASE_NAME.test(name)).sort() : [];
};

export const caseCommand = (run: string, cases: string, name: string): string =>
  run.split(CASE_PLACEHOLDER).join(toPosixPath(join(cases, name)));

const runCase = (runtime: Runtime, root: AbsolutePath, spec: GoldenSpec, name: string, timeoutMs: number) =>
  runtime.exec({
    command: caseCommand(spec.run, spec.cases, name),
    args: [],
    cwd: root,
    shell: true,
    timeoutMs,
    env: { CI: "1" },
  });

export const evaluateCase = (
  runtime: Runtime,
  root: AbsolutePath,
  spec: GoldenSpec,
  name: string,
  deadline: number,
): CaseResult => {
  const timeoutMs = Math.max(1000, Math.min(DEFAULT_CASE_TIMEOUT_MS, deadline - nowMs(runtime)));
  const result = runCase(runtime, root, spec, name, timeoutMs);
  if (!result.found || result.timedOut || result.exitCode !== 0) {
    return { name, kind: "exit", exitCode: result.timedOut ? null : result.exitCode };
  }
  const expected = runtime.readText(expectedPath(root, spec.id, name));
  if (!expected.ok) return { name, kind: "missing", stdout: result.stdout };
  const difference = compareOutput(expected.value, result.stdout, spec.tolerance);
  return difference === undefined
    ? { name, kind: "match", stdout: result.stdout }
    : { name, kind: "diff", stdout: result.stdout, difference };
};
