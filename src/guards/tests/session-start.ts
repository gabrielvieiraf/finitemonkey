import { relative } from "node:path";

import { type AbsolutePath } from "../../core/brand.js";
import { toPosixPath } from "../../core/posix-path.js";
import type { Runtime } from "../../core/runtime.js";
import { readBaseline, readEdits } from "../../git/ownership.js";
import { openRepo, type Repo } from "../../git/repo.js";

export type StartState =
  { readonly kind: "unknown" } | { readonly kind: "absent" } | { readonly kind: "blob"; readonly hash: string };

export interface SessionFile {
  readonly runtime: Runtime;
  readonly repo: Repo;
  readonly owner: string;
  readonly path: string;
}

const UNKNOWN: StartState = { kind: "unknown" };
const ABSENT: StartState = { kind: "absent" };

export const sessionFile = (
  runtime: Runtime,
  root: AbsolutePath,
  owner: string,
  file: AbsolutePath,
): SessionFile | undefined => {
  const repo = openRepo(runtime, root);
  if (repo === undefined) return undefined;
  const path = toPosixPath(relative(runtime.realpath(repo.root), runtime.realpath(file)));
  return path === "" || path.startsWith("..") ? undefined : { runtime, repo, owner, path };
};

const blobAt = (target: SessionFile, spec: string): string | undefined => {
  const result = target.runtime.git(["rev-parse", "--verify", "--quiet", spec], target.repo.root);
  const hash = result.stdout.trim();
  return result.ok && hash !== "" ? hash : undefined;
};

export const startState = (target: SessionFile): StartState => {
  const baseline = readBaseline(target.runtime, target.repo, target.owner);
  if (baseline === undefined) return UNKNOWN;
  const listed = baseline.files[target.path];
  if (listed === "deleted") return ABSENT;
  if (listed === "unknown") return UNKNOWN;
  if (listed !== undefined) return { kind: "blob", hash: listed };
  if (baseline.head === undefined) return ABSENT;
  const hash = blobAt(target, `${baseline.head}:${target.path}`);
  return hash === undefined ? ABSENT : { kind: "blob", hash };
};

const tracked = (target: SessionFile): boolean => {
  const result = target.runtime.git(["ls-files", "--cached", "--", target.path], target.repo.root);
  return !result.ok || result.stdout.trim() !== "";
};

export const createdBySession = (target: SessionFile): boolean =>
  startState(target).kind === "absent" &&
  !tracked(target) &&
  readEdits(target.runtime, target.repo, target.owner).has(target.path);

export const textBlob = (target: SessionFile, text: string): string | undefined => {
  const result = target.runtime.gitWith(["hash-object", "--stdin", `--path=${target.path}`], target.repo.root, {
    input: text,
  });
  const hash = result.stdout.trim();
  return result.ok && hash !== "" ? hash : undefined;
};

export const sourceBlob = (target: SessionFile, source: string | undefined): string | undefined =>
  blobAt(target, source === undefined ? `:${target.path}` : `${source}:${target.path}`);

export const restoresStart = (target: SessionFile, blob: string | undefined): boolean => {
  const start = startState(target);
  return blob !== undefined && start.kind === "blob" && start.hash === blob;
};
