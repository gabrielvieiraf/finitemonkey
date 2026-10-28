import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { HookCheck } from "../githooks/checks.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { ownershipProblems, readVocabulary } from "./check.js";
import { readOwnership } from "./file.js";

export const OWNERSHIP_FEATURE = "ownership";

const FIX = "give each component one owner and a name from the Responsibilities table in docs/plan/MASTER.md";

export const ownershipFailures = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): readonly string[] => {
  const ownership = readOwnership(runtime, root);
  if (ownership === undefined) return [];
  if (!ownership.ok) return [ownership.error];
  const vocabulary = readVocabulary(runtime, root);
  return ownershipProblems(ownership.value.components, vocabulary).map(
    (problem) =>
      `${problem.kind}: ${problem.component}${problem.detail === "" ? "" : ` (${problem.detail})`} in ${ownership.value.file}`,
  );
};

export const ownershipCheck = (
  runtime: Pick<Runtime, "readText" | "appendText" | "now">,
  root: AbsolutePath,
): HookCheck => {
  const paths = fmPaths(root);
  const mode = featureMode(runtime, paths, OWNERSHIP_FEATURE);
  const failures = mode === "off" ? [] : ownershipFailures(runtime, root);
  if (mode === "shadow" && failures.length > 0) {
    recordFeatureShadow(runtime, paths, OWNERSHIP_FEATURE, { failures: [...failures] });
    return { id: "ownership", failures: [], fix: FIX };
  }
  return { id: "ownership", failures, fix: FIX };
};
