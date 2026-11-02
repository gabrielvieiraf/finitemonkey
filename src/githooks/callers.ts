import type { Runtime } from "../core/runtime.js";
import { callSites, removedSymbols } from "../gate/callers/scan.js";
import { changedFiles, gitAt } from "../gate/git.js";
import type { Repo } from "../git/repo.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import type { HookCheck } from "./checks.js";

export const CI_CALLERS_FEATURE = "ci-gate-callers";

const FIX = "keep the removed function, or update each caller listed, then push again";

const callerFailures = (runtime: Runtime, repo: Repo, base: string): readonly string[] => {
  const git = gitAt(runtime, repo.root);
  const from = git.out(["merge-base", base, "HEAD"])?.trim() ?? base;
  const symbols = removedSymbols(runtime, git, from, changedFiles(git, from));
  return callSites(runtime, git, symbols).map(
    (site) => `${site.name} was removed but ${site.file}:${String(site.line)} still calls it`,
  );
};

export const callersInRange = (runtime: Runtime, repo: Repo, base: string): HookCheck => {
  const paths = fmPaths(repo.root);
  const mode = featureMode(runtime, paths, CI_CALLERS_FEATURE);
  const failures = mode === "off" ? [] : callerFailures(runtime, repo, base);
  if (mode === "shadow" && failures.length > 0) {
    recordFeatureShadow(runtime, paths, CI_CALLERS_FEATURE, { failures: [...failures] });
    return { id: "callers", failures: [], fix: FIX };
  }
  return { id: "callers", failures, fix: FIX };
};
