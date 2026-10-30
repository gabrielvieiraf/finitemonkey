import { basename, dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { GitRun, Runtime } from "../core/runtime.js";
import { restoreFiles, type RestoreOutcome } from "./file-store.js";
import { type JournalEntry, readJournal } from "./journal.js";
import type { Repo } from "./repo.js";
import { BACKUP_PREFIX, listSnapshots, storeName, takeSnapshot } from "./snapshot.js";

export interface SnapshotView {
  readonly ref: string;
  readonly commit: string;
  readonly at: string;
  readonly op: string;
  readonly head: string | undefined;
  readonly index: string | undefined;
}

export interface UndoOutcome {
  readonly snapshot: SnapshotView;
  readonly backup: string;
  readonly mode: "worktree" | "in-place";
  readonly path: AbsolutePath | undefined;
  readonly restored: readonly string[];
  readonly conflicts: readonly string[];
}

const INDEX_SUBJECT = "finitemonkey index:";

const gitLine = (runtime: Runtime, repo: Repo, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const failure = (step: string, result: GitRun): string => `${step}: ${result.stderr.trim() || "git failed"}`;

const parentsOf = (runtime: Runtime, repo: Repo, commit: string): { head?: string; index?: string } => {
  const listed = gitLine(runtime, repo, ["rev-list", "--parents", "-n", "1", commit])?.split(" ").slice(1) ?? [];
  return listed.reduce<{ head?: string; index?: string }>((found, parent) => {
    const subject = gitLine(runtime, repo, ["log", "-1", "--format=%s", parent]) ?? "";
    return subject.startsWith(INDEX_SUBJECT) ? { ...found, index: parent } : { ...found, head: parent };
  }, {});
};

const viewOf = (runtime: Runtime, repo: Repo, ref: string, journal: readonly JournalEntry[]): SnapshotView => {
  const entry = journal.find((item) => item.ref === ref);
  if (entry !== undefined) {
    return { ref, commit: entry.commit, at: entry.at, op: entry.op, head: entry.head, index: entry.index };
  }
  const commit = gitLine(runtime, repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) ?? "";
  const parents = parentsOf(runtime, repo, commit);
  return {
    ref,
    commit,
    at: gitLine(runtime, repo, ["log", "-1", "--format=%cI", commit]) ?? "",
    op: (gitLine(runtime, repo, ["log", "-1", "--format=%s", commit]) ?? "").replace(/^finitemonkey snapshot: /, ""),
    head: parents.head,
    index: parents.index,
  };
};

export const snapshotViews = (runtime: Runtime, repo: Repo): readonly SnapshotView[] => {
  const journal = readJournal(runtime, repo.root);
  return listSnapshots(runtime, repo).map((ref) => viewOf(runtime, repo, ref, journal));
};

export const findSnapshot = (views: readonly SnapshotView[], wanted: string | undefined): SnapshotView | undefined => {
  if (wanted === undefined) return views[0];
  if (/^\d+$/.test(wanted)) return views[Number(wanted) - 1];
  const full = wanted.startsWith("refs/") ? wanted : `${BACKUP_PREFIX}${wanted}`;
  return views.find((view) => view.ref === full || view.commit.startsWith(wanted));
};

const stampOf = (iso: string): string => iso.replace(/[:.]/g, "-");

const worktreePath = (runtime: Runtime, repo: Repo): AbsolutePath => {
  const base = join(dirname(repo.root), `${basename(repo.root)}-undo-${stampOf(runtime.now())}`);
  return toAbsolutePath(runtime.stat(toAbsolutePath(base)) === undefined ? base : `${base}-2`);
};

const intoWorktree = (runtime: Runtime, repo: Repo, view: SnapshotView): Parsed<AbsolutePath> => {
  const path = worktreePath(runtime, repo);
  const added = runtime.gitWith(["worktree", "add", "--detach", path, view.commit], repo.root, {});
  return added.ok ? accept(path) : reject(failure("worktree add", added));
};

const step = (runtime: Runtime, repo: Repo, args: readonly string[]): Parsed<undefined> => {
  const result = runtime.gitWith(args, repo.root, {});
  return result.ok ? accept(undefined) : reject(failure(args.join(" "), result));
};

const inPlace = (runtime: Runtime, repo: Repo, view: SnapshotView): Parsed<undefined> => {
  const current = gitLine(runtime, repo, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (view.head !== undefined && view.head !== current) {
    const moved = step(runtime, repo, ["reset", "--soft", view.head]);
    if (!moved.ok) return moved;
  }
  const tree = step(runtime, repo, ["read-tree", "--reset", "-u", view.commit]);
  if (!tree.ok) return tree;
  const index = view.index ?? view.head;
  return step(runtime, repo, index === undefined ? ["read-tree", "--empty"] : ["read-tree", index]);
};

export const undoSnapshot = (
  runtime: Runtime,
  repo: Repo,
  view: SnapshotView,
  mode: UndoOutcome["mode"],
): Parsed<UndoOutcome> => {
  const backup = takeSnapshot(runtime, repo, { op: `before undo ${view.ref.replace(BACKUP_PREFIX, "")}` });
  if (!backup.ok) return reject(`snapshot: ${backup.error}`);
  const files = (target: AbsolutePath): Parsed<RestoreOutcome> =>
    restoreFiles(runtime, repo, storeName(view.ref), target);
  if (mode === "worktree") {
    const path = intoWorktree(runtime, repo, view);
    if (!path.ok) return path;
    const copied = files(path.value);
    return copied.ok
      ? accept({ snapshot: view, backup: backup.value.ref, mode, path: path.value, ...copied.value })
      : copied;
  }
  const restored = inPlace(runtime, repo, view);
  if (!restored.ok) return restored;
  const copied = files(repo.root);
  return copied.ok
    ? accept({ snapshot: view, backup: backup.value.ref, mode, path: undefined, ...copied.value })
    : copied;
};
