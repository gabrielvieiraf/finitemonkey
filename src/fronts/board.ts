import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type GateLight, gateLight } from "../statusline/gate-state.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { activityOf, type GitWorktree, gitWorktrees } from "../wt/git-list.js";
import { readFronts } from "./state.js";

export const BOARD_SCHEMA = "finitemonkey/fronts-board@1";
const READ_ONLY = { GIT_OPTIONAL_LOCKS: "0" } as const;

export interface BoardRow {
  readonly path: string;
  readonly branch: string | null;
  readonly gate: GateLight;
  readonly contract: string | null;
  readonly lastActivity: string | null;
  readonly waiting: boolean;
  readonly files: readonly string[];
}

export interface Collision {
  readonly file: string;
  readonly branches: readonly string[];
}

export interface BoardData {
  readonly schema: typeof BOARD_SCHEMA;
  readonly rows: readonly BoardRow[];
  readonly collisions: readonly Collision[];
}

const lines = (text: string): readonly string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const git = (runtime: Runtime, dir: AbsolutePath, args: readonly string[]): string => {
  const result = runtime.gitWith(args, dir, { env: READ_ONLY });
  return result.ok ? result.stdout : "";
};

const changedFiles = (runtime: Runtime, dir: AbsolutePath, base: string | null): readonly string[] => {
  const fork = base === null ? "" : git(runtime, dir, ["merge-base", "HEAD", base]).trim();
  const committed = fork === "" ? [] : lines(git(runtime, dir, ["diff", "--name-only", fork, "HEAD"]));
  const open = git(runtime, dir, ["status", "--porcelain", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).replace(/^.* -> /, ""))
    .filter((file) => !file.startsWith(".finitemonkey/"));
  return [...new Set([...committed, ...open])].sort();
};

const waitingPaths = (runtime: Runtime, main: AbsolutePath): ReadonlySet<string> => {
  const state = readFronts(runtime, main);
  if (!state.ok) return new Set();
  return new Set(
    state.value.fronts
      .filter((front) => front.status === "blocked" || front.inbox.length > 0)
      .flatMap((front) => (front.path === null ? [] : [toAbsolutePath(front.path)])),
  );
};

const rowOf = (runtime: Runtime, tree: GitWorktree, base: string | null, waiting: ReadonlySet<string>): BoardRow => {
  const dir = toAbsolutePath(tree.path);
  const paths = fmPaths(dir);
  return {
    path: tree.path,
    branch: tree.branch,
    gate: gateLight(runtime, paths),
    contract: readState(runtime, paths).active ?? null,
    lastActivity: activityOf(runtime, tree) ?? null,
    waiting: waiting.has(dir),
    files: tree.main ? [] : changedFiles(runtime, dir, base),
  };
};

export const collisionsOf = (rows: readonly BoardRow[]): readonly Collision[] => {
  const owners = new Map<string, string[]>();
  for (const row of rows)
    for (const file of row.files) owners.set(file, [...(owners.get(file) ?? []), row.branch ?? row.path]);
  return [...owners.entries()]
    .filter(([, branches]) => branches.length > 1)
    .map(([file, branches]) => ({ file, branches }))
    .sort((a, b) => a.file.localeCompare(b.file));
};

export const boardOf = (runtime: Runtime, cwd: AbsolutePath): BoardData => {
  const trees = (gitWorktrees(runtime, cwd) ?? []).filter((tree) => !tree.bare && !tree.prunable);
  const main = trees.find((tree) => tree.main);
  const base = main?.branch ?? null;
  const waiting = main === undefined ? new Set<string>() : waitingPaths(runtime, toAbsolutePath(main.path));
  const rows = trees.map((tree) => rowOf(runtime, tree, base, waiting));
  return { schema: BOARD_SCHEMA, rows, collisions: collisionsOf(rows) };
};
