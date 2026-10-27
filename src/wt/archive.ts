import { basename, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { openRepo, type Repo } from "../git/repo.js";
import { DEFAULT_SNAPSHOT_TIMEOUT_MS } from "../git/snapshot.js";
import { commitTree, type TreeOptions, worktreeTree } from "../git/tree.js";
import { isSensitivePath } from "../secrets/guards/paths.js";
import { scanFile } from "../secrets/scan.js";
import { isGeneratedPath } from "./generated.js";

export const ARCHIVE_PREFIX = "refs/finitemonkey/archive/";

export interface ArchiveRequest {
  readonly path: string;
  readonly id: string;
  readonly branch: string | null;
  readonly mainRoot: AbsolutePath;
  readonly remove: boolean;
  readonly deleteBranch: boolean;
  readonly generated: readonly string[];
}

export interface ArchiveOutcome {
  readonly ref: string;
  readonly commit: string;
  readonly copied: readonly string[];
  readonly secrets: readonly string[];
  readonly copiedTo: string | null;
  readonly removed: boolean;
  readonly branchDeleted: boolean;
}

const stampOf = (iso: string): string => iso.replace(/[:.]/g, "-");

const refName = (request: ArchiveRequest, stamp: string): string =>
  `${ARCHIVE_PREFIX}${(request.branch ?? request.id).replace(/[^A-Za-z0-9._/-]/g, "-")}/${stamp}`;

const line = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, cwd);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const ignoredFiles = (runtime: Runtime, repo: Repo, generated: readonly string[]): readonly string[] => {
  const listed = runtime.gitWith(["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], repo.root, {
    env: { GIT_OPTIONAL_LOCKS: "0" },
  });
  if (!listed.ok) return [];
  return listed.stdout
    .split("\u0000")
    .filter((path) => path !== "" && !isGeneratedPath(path, generated) && !path.startsWith(".finitemonkey/"));
};

const copyIgnored = (
  runtime: Runtime,
  repo: Repo,
  files: readonly string[],
  target: AbsolutePath,
): { readonly copied: readonly string[]; readonly secrets: readonly string[] } => {
  const secrets = files.filter((file) => isSensitivePath(file) || scanFile(runtime, repo.root, file).length > 0);
  const copied = files
    .filter((file) => !secrets.includes(file))
    .filter((file) => runtime.copyFile(toAbsolutePath(join(repo.root, file)), toAbsolutePath(join(target, file))).ok);
  return { copied, secrets };
};

const snapshotTree = (runtime: Runtime, repo: Repo, head: string | undefined, stamp: string): Parsed<string> =>
  worktreeTree(runtime, repo, head, { timeoutMs: DEFAULT_SNAPSHOT_TIMEOUT_MS, stamp });

const finish = (runtime: Runtime, request: ArchiveRequest): Parsed<{ removed: boolean; branchDeleted: boolean }> => {
  if (!request.remove) return accept({ removed: false, branchDeleted: false });
  runtime.gitWith(["worktree", "unlock", request.path], request.mainRoot, {});
  const removed = runtime.gitWith(["worktree", "remove", "--force", request.path], request.mainRoot, {});
  if (!removed.ok) return reject(`worktree remove: ${removed.stderr.trim()}`);
  if (!request.deleteBranch || request.branch === null) return accept({ removed: true, branchDeleted: false });
  const deleted = runtime.gitWith(["branch", "-D", request.branch], request.mainRoot, {});
  return accept({ removed: true, branchDeleted: deleted.ok });
};

export const archiveWorktree = (runtime: Runtime, request: ArchiveRequest): Parsed<ArchiveOutcome> => {
  const repo = openRepo(runtime, toAbsolutePath(request.path));
  if (repo === undefined) return reject(`${request.path}: not a git worktree`);
  const stamp = stampOf(runtime.now());
  const options: TreeOptions = { timeoutMs: DEFAULT_SNAPSHOT_TIMEOUT_MS, stamp };
  const head = line(runtime, repo.root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const tree = snapshotTree(runtime, repo, head, `${stamp}-a`);
  if (!tree.ok) return tree;
  const message = `finitemonkey archive: ${request.branch ?? request.id}`;
  const commit = commitTree(runtime, repo, tree.value, head === undefined ? [] : [head], message, options);
  if (!commit.ok) return commit;
  const ref = refName(request, stamp);
  if (!runtime.git(["update-ref", "--create-reflog", ref, commit.value, ""], repo.root).ok) {
    return reject(`update-ref ${ref}: could not create the archive ref`);
  }
  const target = toAbsolutePath(
    join(runtime.homeDir(), ".finitemonkey", "archive", basename(request.mainRoot), request.id, stamp),
  );
  const kept = copyIgnored(runtime, repo, ignoredFiles(runtime, repo, request.generated), target);
  const again = snapshotTree(runtime, repo, head, `${stamp}-b`);
  if (!again.ok || again.value !== tree.value)
    return reject(`${request.path}: changed while archiving; nothing removed`);
  const done = finish(runtime, request);
  if (!done.ok) return done;
  return accept({
    ref,
    commit: commit.value,
    copied: kept.copied,
    secrets: kept.secrets,
    copiedTo: kept.copied.length > 0 ? target : null,
    ...done.value,
  });
};
