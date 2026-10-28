import type { AbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Repo } from "../git/repo.js";
import { takeSnapshot } from "../git/snapshot.js";
import { integrationTargets, isContained, isEquivalent } from "../wt/branch-state.js";
import { entryFor } from "../wt/inventory.js";
import { commonDirOf, readRegistry } from "../wt/store.js";

export type StackPlan =
  | { readonly kind: "none" }
  | { readonly kind: "parent-open"; readonly parent: string }
  | { readonly kind: "parent-merged"; readonly parent: string }
  | { readonly kind: "restack"; readonly parent: string };

const line = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

export const parentOf = (runtime: Runtime, root: AbsolutePath): string | undefined => {
  const common = commonDirOf(runtime, root);
  const registry = common === undefined ? undefined : readRegistry(runtime, common);
  return registry?.ok === true ? (entryFor(registry.value, root)?.parent ?? undefined) : undefined;
};

export const stackPlan = (runtime: Runtime, root: AbsolutePath, defaultBranch: string): StackPlan => {
  const parent = parentOf(runtime, root);
  if (parent === undefined || parent === defaultBranch) return { kind: "none" };
  const tip = line(runtime, root, ["rev-parse", "--verify", "--quiet", `${parent}^{commit}`]);
  if (tip === undefined) return { kind: "none" };
  const targets = integrationTargets(runtime, root, defaultBranch, []);
  if (isContained(runtime, root, tip, targets)) return { kind: "parent-merged", parent };
  if (isEquivalent(runtime, root, tip, targets)) return { kind: "restack", parent };
  return { kind: "parent-open", parent };
};

const lostPatches = (runtime: Runtime, root: AbsolutePath, oldRange: string, newRange: string): readonly string[] =>
  runtime
    .git(["range-diff", "--no-color", oldRange, newRange], root)
    .stdout.split("\n")
    .filter((row) => /^\s*\d+:\s+[0-9a-f]+\s+<\s+-:/.test(row));

export const restack = (
  runtime: Runtime,
  repo: Repo,
  parent: string,
  onto: string,
): Parsed<{ readonly snapshot: string }> => {
  const root = repo.root;
  const oldTip = line(runtime, root, ["rev-parse", "HEAD"]);
  if (oldTip === undefined) return reject("no HEAD");
  const snapshot = takeSnapshot(runtime, repo, { op: `restack onto ${onto}` });
  if (!snapshot.ok) return reject(`snapshot: ${snapshot.error}`);
  const rebased = runtime.gitWith(["rebase", "--onto", onto, parent], root, {});
  if (!rebased.ok) {
    runtime.gitWith(["rebase", "--abort"], root, {});
    return reject(`rebase --onto ${onto} ${parent}: ${rebased.stderr.trim()}`);
  }
  const lost = lostPatches(runtime, root, `${parent}..${oldTip}`, `${onto}..HEAD`);
  if (lost.length > 0) {
    runtime.gitWith(["reset", "--keep", oldTip], root, {});
    return reject(`range-diff shows ${String(lost.length)} patch(es) missing after the restack`);
  }
  return accept({ snapshot: snapshot.value.ref });
};
