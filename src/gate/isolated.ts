import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { defaultPlace, isWithinPath } from "../wt/place.js";
import { reap } from "../wt/reap.js";
import { changedFiles, EXCLUDE_FM, gitAt, treeHash } from "./git.js";
import type { Prepared } from "./prepare.js";

export const ISOLATED_FEATURE = "gate-isolated";
const INSTALL_FLOOR_MS = 60_000;
const TAIL = 200;

export const FROZEN_INSTALLS = [
  ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
  ["yarn.lock", "yarn install --frozen-lockfile"],
  ["bun.lock", "bun install --frozen-lockfile"],
  ["bun.lockb", "bun install --frozen-lockfile"],
  ["package-lock.json", "npm ci"],
  ["npm-shrinkwrap.json", "npm ci"],
  ["uv.lock", "uv sync --locked"],
] as const;

export type IsolatedStep = "worktree" | "staged" | "tree" | "install";

export interface IsolatedFailure {
  readonly kind: "isolated";
  readonly step: IsolatedStep;
  readonly detail: string;
}

const failure = (step: IsolatedStep, detail: string): IsolatedFailure => ({ kind: "isolated", step, detail });

export const frozenInstall = (exists: (file: string) => boolean): string | undefined =>
  FROZEN_INSTALLS.find(([file]) => exists(file))?.[1];

const lastLine = (text: string): string => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return (lines[lines.length - 1] ?? "").trim().slice(0, TAIL);
};

const isolatedDir = (runtime: Runtime, root: AbsolutePath): AbsolutePath =>
  defaultPlace(root, runtime.homeDir(), `gate-isolated-${runtime.now().replace(/[^0-9A-Za-z]/g, "")}`);

const applyStaged = (runtime: Runtime, root: AbsolutePath, dir: AbsolutePath): Parsed<undefined, IsolatedFailure> => {
  const staged = runtime.gitWith(["diff", "--cached", "--binary", "--no-color", "--", ".", EXCLUDE_FM], root, {});
  if (!staged.ok) return reject(failure("staged", lastLine(staged.stderr)));
  if (staged.stdout.trim() === "") return accept(undefined);
  const applied = runtime.gitWith(["apply", "--index", "--whitespace=nowarn"], dir, { input: staged.stdout });
  return applied.ok ? accept(undefined) : reject(failure("staged", lastLine(applied.stderr)));
};

const install = (runtime: Runtime, dir: AbsolutePath, deadline: number): Parsed<undefined, IsolatedFailure> => {
  const command = frozenInstall((file) => runtime.stat(toAbsolutePath(join(dir, file))) !== undefined);
  if (command === undefined) return accept(undefined);
  const result = runtime.exec({
    command,
    args: [],
    cwd: dir,
    shell: true,
    timeoutMs: Math.max(INSTALL_FLOOR_MS, deadline - nowMs(runtime)),
    env: { CI: "1" },
  });
  if (result.found && result.exitCode === 0) return accept(undefined);
  const why = result.timedOut ? "timed out" : lastLine(`${result.stdout}\n${result.stderr}`);
  return reject(failure("install", `${command}: ${why}`));
};

const cleanup = (runtime: Runtime, root: AbsolutePath, dir: AbsolutePath): void => {
  reap(
    runtime,
    runtime
      .processes()
      .filter((info) => isWithinPath(dir, info.cwd))
      .map((info) => info.pid),
  );
  runtime.gitWith(["worktree", "remove", "--force", dir], root, {});
  runtime.gitWith(["worktree", "prune"], root, {});
  if (runtime.stat(dir) !== undefined) runtime.remove(dir);
};

const isolatedPrepared = (runtime: Runtime, prepared: Prepared, dir: AbsolutePath): Prepared | undefined => {
  const git = gitAt(runtime, dir);
  const tree = treeHash(git);
  if (tree === undefined) return undefined;
  const { ctx } = prepared;
  return {
    ...prepared,
    ctx: { ...ctx, git, paths: { ...ctx.paths, root: dir }, treeHash: tree, changes: changedFiles(git, ctx.base) },
  };
};

const runInside = <T>(
  runtime: Runtime,
  prepared: Prepared,
  dir: AbsolutePath,
  run: (isolated: Prepared) => T,
): Parsed<T, IsolatedFailure> => {
  const staged = applyStaged(runtime, prepared.ctx.paths.root, dir);
  if (!staged.ok) return staged;
  const isolated = isolatedPrepared(runtime, prepared, dir);
  if (isolated === undefined) return reject(failure("tree", dir));
  const installed = install(runtime, dir, prepared.ctx.deadline);
  return installed.ok ? accept(run(isolated)) : installed;
};

export const withIsolatedTree = <T>(
  runtime: Runtime,
  prepared: Prepared,
  run: (isolated: Prepared) => T,
): Parsed<T, IsolatedFailure> => {
  const root = prepared.ctx.paths.root;
  const dir = isolatedDir(runtime, root);
  const added = runtime.gitWith(["worktree", "add", "--detach", "--force", dir, "HEAD"], root, {});
  if (!added.ok) {
    cleanup(runtime, root, dir);
    return reject(failure("worktree", lastLine(added.stderr)));
  }
  try {
    return runInside(runtime, prepared, dir, run);
  } finally {
    cleanup(runtime, root, dir);
  }
};
