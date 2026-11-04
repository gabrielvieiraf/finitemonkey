import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
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
  readonly sessionId: string | null;
  readonly resume: string | null;
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
    .filter((file) => !file.startsWith(`${DATA_DIR}/`));
  return [...new Set([...committed, ...open])].sort();
};

interface FrontMarks {
  readonly waiting: ReadonlySet<string>;
  readonly sessions: ReadonlyMap<string, string>;
}

const NO_MARKS: FrontMarks = { waiting: new Set(), sessions: new Map() };

const frontMarks = (runtime: Runtime, main: AbsolutePath): FrontMarks => {
  const state = readFronts(runtime, main);
  if (!state.ok) return NO_MARKS;
  const placed = state.value.fronts.flatMap((front) =>
    front.path === null ? [] : [{ front, path: toAbsolutePath(front.path) }],
  );
  return {
    waiting: new Set(
      placed.filter(({ front }) => front.status === "blocked" || front.inbox.length > 0).map(({ path }) => path),
    ),
    sessions: new Map(
      placed.flatMap(({ front, path }) => (front.sessionId === undefined ? [] : [[path, front.sessionId] as const])),
    ),
  };
};

export const resumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`;

const rowOf = (runtime: Runtime, tree: GitWorktree, base: string | null, marks: FrontMarks): BoardRow => {
  const dir = toAbsolutePath(tree.path);
  const paths = fmPaths(dir);
  const sessionId = marks.sessions.get(dir) ?? null;
  return {
    path: tree.path,
    branch: tree.branch,
    gate: gateLight(runtime, paths),
    contract: readState(runtime, paths).active ?? null,
    lastActivity: activityOf(runtime, tree) ?? null,
    waiting: marks.waiting.has(dir),
    files: tree.main ? [] : changedFiles(runtime, dir, base),
    sessionId,
    resume: sessionId === null ? null : resumeCommand(sessionId),
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
  const marks = main === undefined ? NO_MARKS : frontMarks(runtime, toAbsolutePath(main.path));
  const rows = trees.map((tree) => rowOf(runtime, tree, base, marks));
  return { schema: BOARD_SCHEMA, rows, collisions: collisionsOf(rows) };
};
