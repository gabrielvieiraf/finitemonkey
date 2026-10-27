import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

const lines = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): readonly string[] | undefined => {
  const result = runtime.gitWith(args, root, { env: { GIT_OPTIONAL_LOCKS: "0" } });
  return result.ok ? result.stdout.split("\n").filter((line) => line.trim() !== "") : undefined;
};

const refExists = (runtime: Runtime, root: AbsolutePath, ref: string): boolean =>
  runtime.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root).ok;

export const integrationTargets = (
  runtime: Runtime,
  root: AbsolutePath,
  defaultBranch: string,
  extra: readonly (string | null)[],
): readonly string[] => {
  const names = [defaultBranch, ...extra.flatMap((name) => (name === null ? [] : [name]))];
  const refs = names.flatMap((name) => [`refs/heads/${name}`, `refs/remotes/origin/${name}`]);
  return [...new Set(refs)].filter((ref) => refExists(runtime, root, ref));
};

export const isContained = (runtime: Runtime, root: AbsolutePath, tip: string, targets: readonly string[]): boolean =>
  targets.some((target) => runtime.git(["merge-base", "--is-ancestor", tip, target], root).ok);

const sameContent = (runtime: Runtime, root: AbsolutePath, tip: string, target: string): boolean => {
  const base = lines(runtime, root, ["merge-base", tip, target])?.[0];
  if (base === undefined) return false;
  const changed = lines(runtime, root, ["diff", "--name-only", "--no-renames", base, tip]);
  if (changed === undefined || changed.length === 0) return false;
  const blob = (ref: string, path: string): string =>
    runtime.git(["rev-parse", "--verify", "--quiet", `${ref}:${path}`], root).stdout.trim();
  return changed.every((path) => blob(tip, path) === blob(target, path));
};

export const isEquivalent = (runtime: Runtime, root: AbsolutePath, tip: string, targets: readonly string[]): boolean =>
  targets.some((target) => {
    const cherry = lines(runtime, root, ["cherry", target, tip]);
    if (cherry !== undefined && cherry.length > 0 && cherry.every((line) => line.startsWith("-"))) return true;
    return sameContent(runtime, root, tip, target);
  });

export const isUnpushed = (runtime: Runtime, root: AbsolutePath, tip: string): boolean =>
  (lines(runtime, root, ["rev-list", "--max-count=1", tip, "--not", "--remotes"])?.length ?? 1) > 0;
