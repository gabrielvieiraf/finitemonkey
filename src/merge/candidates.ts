import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { removeScratch, scratchDir } from "../gate/isolated.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { MERGE_CANDIDATES_FEATURE } from "../policy/merge-guards.js";
import { fmPaths } from "../task/paths.js";
import { applyResolutions } from "./apply.js";
import { INTEGRATION_CONFIG, type Sides } from "./integrate.js";
import type { FileResolution } from "./resolve-file.js";

const CHECK_TIMEOUT_MS = 600_000;
export const CANDIDATE_PREFIX = "merge-candidate";

export type CandidateTest = "passed" | "failed";

export interface CandidateInput {
  readonly runtime: Runtime;
  readonly cwd: AbsolutePath;
  readonly sides: Sides;
  readonly files: readonly FileResolution[];
  readonly proposals: ReadonlySet<string>;
  readonly checks: readonly string[];
}

const checksPass = (runtime: Runtime, dir: AbsolutePath, checks: readonly string[]): boolean =>
  checks.every(
    (command) => runtime.exec({ command, args: [], cwd: dir, timeoutMs: CHECK_TIMEOUT_MS, shell: true }).exitCode === 0,
  );

const tryCandidates = (input: CandidateInput, dir: AbsolutePath): CandidateTest => {
  const { runtime, sides, files, proposals } = input;
  const added = runtime.gitWith(["worktree", "add", "--detach", "--force", dir, sides.targetSha], input.cwd, {});
  if (!added.ok) return "failed";
  runtime.gitWith([...INTEGRATION_CONFIG, "merge", "--no-ff", "--no-commit", sides.sourceSha], dir, {});
  const others = files.filter((file) => !proposals.has(file.path));
  const staged = runtime.gitWith(["add", "--", ...proposals], dir, {}).ok;
  if (!staged || applyResolutions(runtime, dir, others).length > 0) return "failed";
  if (others.some((file) => file.stop !== undefined)) return "failed";
  return checksPass(runtime, dir, input.checks) ? "passed" : "failed";
};

export const testCandidates = (input: CandidateInput): CandidateTest | undefined => {
  if (input.proposals.size === 0 || input.checks.length === 0) return undefined;
  const paths = fmPaths(input.cwd);
  const mode = featureMode(input.runtime, paths, MERGE_CANDIDATES_FEATURE);
  if (mode === "shadow")
    recordFeatureShadow(input.runtime, paths, MERGE_CANDIDATES_FEATURE, { candidates: [...input.proposals] });
  if (mode !== "active") return undefined;
  const dir = scratchDir(input.runtime, input.cwd, CANDIDATE_PREFIX);
  try {
    return tryCandidates(input, dir);
  } finally {
    removeScratch(input.runtime, input.cwd, dir);
  }
};
