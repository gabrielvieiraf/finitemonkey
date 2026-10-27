import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { EXCLUDE_FM, gitAt, treeHash } from "../gate/git.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";

export interface ProjectView {
  readonly files: readonly string[];
  readonly grep: (pattern: string) => boolean;
  readonly manifests: string;
  readonly passed: (kind: string) => boolean;
  readonly tree: string | undefined;
}

const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "Gemfile", "go.mod", "composer.json"];

const IGNORED = ":(exclude)node_modules";

const listFiles = (runtime: Pick<Runtime, "exec">, root: AbsolutePath): readonly string[] =>
  (
    gitAt(runtime, root).out(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ".", EXCLUDE_FM]) ??
    ""
  )
    .split("\0")
    .filter((path) => path !== "");

const grepper = (runtime: Pick<Runtime, "exec">, root: AbsolutePath): ((pattern: string) => boolean) => {
  const git = gitAt(runtime, root);
  const cache = new Map<string, boolean>();
  return (pattern) => {
    const known = cache.get(pattern);
    if (known !== undefined) return known;
    const result = git.run([
      "grep",
      "-q",
      "-I",
      "-i",
      "-E",
      "--untracked",
      "-e",
      pattern,
      "--",
      ".",
      EXCLUDE_FM,
      IGNORED,
    ]);
    const found = result.found && result.exitCode === 0;
    cache.set(pattern, found);
    return found;
  };
};

const manifestText = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): string =>
  MANIFESTS.map((name) => {
    const text = runtime.readText(toAbsolutePath(join(root, name)));
    return text.ok ? text.value : "";
  }).join("\n");

const passedChecks = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  tree: string | undefined,
): ((kind: string) => boolean) => {
  const paths = fmPaths(root);
  const task = readState(runtime, paths).active;
  if (task === undefined || tree === undefined) return () => false;
  const ledger = readLedger(runtime, paths.evidence(task));
  return (kind) => ledger.findLast((entry) => entry.kind === kind && entry.treeHash === tree)?.status === "passed";
};

export const projectView = (runtime: Pick<Runtime, "exec" | "readText">, root: AbsolutePath): ProjectView => {
  const tree = treeHash(gitAt(runtime, root));
  return {
    files: listFiles(runtime, root),
    grep: grepper(runtime, root),
    manifests: manifestText(runtime, root),
    passed: passedChecks(runtime, root, tree),
    tree,
  };
};
