import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { appendJournal, JOURNAL_SCHEMA, type JournalEntry } from "./journal.js";
import type { Repo } from "./repo.js";
import { commitTree, indexTree, type TreeOptions, worktreeTree } from "./tree.js";

export const BACKUP_PREFIX = "refs/finitemonkey/backup/";
export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 5000;

export interface SnapshotRequest {
  readonly op: string;
  readonly owner?: string;
  readonly command?: string;
  readonly timeoutMs?: number;
}

const stampOf = (iso: string): string => iso.replace(/[:.]/g, "-");

const slug = (op: string): string =>
  op
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "manual";

const optionalLine = (runtime: Runtime, repo: Repo, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const branchHeads = (runtime: Runtime, repo: Repo): Readonly<Record<string, string>> => {
  const listed = runtime.git(
    ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/stash"],
    repo.root,
  );
  if (!listed.ok) return {};
  return Object.fromEntries(
    listed.stdout.split("\n").flatMap((line) => {
      const [ref, sha] = line.split(" ");
      return ref === undefined || sha === undefined || ref === "" ? [] : [[ref, sha] as const];
    }),
  );
};

const createRef = (runtime: Runtime, repo: Repo, base: string, commit: string): Parsed<string> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = attempt === 0 ? base : `${base}-${String(attempt + 1)}`;
    if (runtime.git(["update-ref", "--create-reflog", ref, commit, ""], repo.root).ok) return accept(ref);
  }
  return reject(`update-ref ${base}: could not create the backup ref`);
};

const snapshotCommit = (
  runtime: Runtime,
  repo: Repo,
  head: string | undefined,
  op: string,
  options: TreeOptions,
): Parsed<{ commit: string; index: string | undefined }> => {
  const tree = worktreeTree(runtime, repo, head, options);
  if (!tree.ok) return tree;
  const parents = head === undefined ? [] : [head];
  const staged = indexTree(runtime, repo, options);
  const indexCommit = staged.ok
    ? commitTree(runtime, repo, staged.value, parents, `finitemonkey index: ${op}`, options)
    : undefined;
  const index = indexCommit?.ok === true ? indexCommit.value : undefined;
  const commit = commitTree(
    runtime,
    repo,
    tree.value,
    [...parents, ...(index === undefined ? [] : [index])],
    `finitemonkey snapshot: ${op}`,
    options,
  );
  return commit.ok ? accept({ commit: commit.value, index }) : commit;
};

export const takeSnapshot = (runtime: Runtime, repo: Repo, request: SnapshotRequest): Parsed<JournalEntry> => {
  const at = runtime.now();
  const options: TreeOptions = { timeoutMs: request.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS, stamp: stampOf(at) };
  const head = optionalLine(runtime, repo, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const made = snapshotCommit(runtime, repo, head, request.op, options);
  if (!made.ok) return made;
  const ref = createRef(runtime, repo, `${BACKUP_PREFIX}${options.stamp}-${slug(request.op)}`, made.value.commit);
  if (!ref.ok) return ref;
  const entry: JournalEntry = {
    schema: JOURNAL_SCHEMA,
    at,
    op: request.op,
    ref: ref.value,
    commit: made.value.commit,
    head,
    branch: optionalLine(runtime, repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    index: made.value.index,
    owner: request.owner,
    command: request.command,
    heads: branchHeads(runtime, repo),
  };
  const logged = appendJournal(runtime, repo.root, entry);
  return logged.ok ? accept(entry) : reject(`journal: ${logged.error}`);
};

export const listSnapshots = (runtime: Runtime, repo: Repo): readonly string[] => {
  const listed = runtime.git(["for-each-ref", "--sort=-refname", "--format=%(refname)", BACKUP_PREFIX], repo.root);
  return listed.ok ? listed.stdout.split("\n").filter((line) => line !== "") : [];
};
