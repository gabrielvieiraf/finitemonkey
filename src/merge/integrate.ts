import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { BACKUP_PREFIX } from "../git/snapshot.js";
import { newWorktree } from "../wt/create.js";
import type { WorktreeEntry, WorktreeOwner } from "../wt/entry.js";

export const INTEGRATION_CONFIG = [
  "-c",
  "merge.conflictStyle=zdiff3",
  "-c",
  "rerere.enabled=true",
  "-c",
  "rerere.autoUpdate=false",
] as const;

export interface Sides {
  readonly targetRef: string;
  readonly targetSha: string;
  readonly sourceRef: string;
  readonly sourceSha: string;
  readonly bases: readonly string[];
}

const line = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, cwd);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

export const resolveSides = (
  runtime: Runtime,
  cwd: AbsolutePath,
  source: string,
  target: string | undefined,
): Parsed<Sides> => {
  const targetRef = target ?? line(runtime, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? "HEAD";
  const sha = (ref: string): string | undefined =>
    line(runtime, cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const targetSha = sha(targetRef);
  const sourceSha = sha(source);
  if (targetSha === undefined) return reject(`unknown target ${targetRef}`);
  if (sourceSha === undefined) return reject(`unknown source ${source}`);
  const bases = runtime.git(["merge-base", "--all", targetSha, sourceSha], cwd);
  const list = bases.ok ? bases.stdout.split("\n").filter((item) => item !== "") : [];
  if (list.length === 0) return reject(`no merge base between ${targetRef} and ${source}`);
  return accept({ targetRef, targetSha, sourceRef: source, sourceSha, bases: list });
};

export const stampOf = (iso: string): string => iso.replace(/[:.]/g, "-");

const slug = (ref: string): string =>
  ref
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export const snapshotTips = (runtime: Runtime, cwd: AbsolutePath, sides: Sides, stamp: string): readonly string[] =>
  [
    [`${BACKUP_PREFIX}${stamp}-merge-target`, sides.targetSha],
    [`${BACKUP_PREFIX}${stamp}-merge-source`, sides.sourceSha],
  ].flatMap(([ref = "", sha = ""]) => (runtime.git(["update-ref", ref, sha, ""], cwd).ok ? [ref] : []));

export interface Integration {
  readonly entry: WorktreeEntry;
  readonly path: AbsolutePath;
  readonly conflicted: boolean;
}

export const openIntegration = (
  runtime: Runtime,
  cwd: AbsolutePath,
  env: Env,
  sides: Sides,
  owner: WorktreeOwner,
): Parsed<Integration> => {
  const stamp = stampOf(runtime.now());
  const made = newWorktree(runtime, cwd, env, {
    id: `integrate-${stamp.slice(0, 19)}`,
    purpose: `merge ${sides.sourceRef} into ${sides.targetRef}`,
    base: sides.targetSha,
    branch: `integrate/${slug(sides.targetRef)}-${slug(sides.sourceRef)}-${stamp}`,
    path: undefined,
    task: undefined,
    parent: sides.targetRef,
    portBase: 5174,
    owner,
  });
  if (!made.ok)
    return reject(`integration worktree: ${made.error.kind === "git" ? made.error.detail : made.error.kind}`);
  const path = toAbsolutePath(made.value.path);
  const message = `Merge ${sides.sourceRef} into ${sides.targetRef}`;
  const merged = runtime.gitWith(
    [...INTEGRATION_CONFIG, "merge", "--no-ff", "--no-commit", "-m", message, sides.sourceSha],
    path,
    {},
  );
  const inProgress = runtime.git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], path).ok;
  if (!merged.ok && !inProgress) return reject(`git merge: ${merged.stderr.trim() || merged.stdout.trim()}`);
  return accept({ entry: made.value, path, conflicted: !merged.ok });
};
