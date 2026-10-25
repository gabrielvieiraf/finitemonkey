import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { Env } from "../core/context.js";
import { accept, type Parsed } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { maskText } from "../mask/mask.js";
import type { ProjectFiles } from "../task/implicit.js";
import { activeTaskId, type LoadedContract, loadImplicit, type LoadProblem, loadTask } from "../task/load.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { type GateTrust, readTrust } from "../task/state.js";
import { readBaseline, readSession } from "./baseline.js";
import {
  type Change,
  changedFiles,
  EMPTY_TREE,
  fileAt,
  type Git,
  gitAt,
  gitRoot,
  resolveBase,
  treeHash,
} from "./git.js";
import { type PrStatus, prStatus } from "./pr.js";
import type { Baseline, GateContext } from "./types.js";

export interface GateOptions {
  readonly runtime: Runtime;
  readonly cwd: AbsolutePath;
  readonly env: Env;
  readonly sessionId: string | undefined;
  readonly taskId?: string;
  readonly budgetMs: number;
  readonly fast: boolean;
  readonly mask?: (text: string) => string;
  readonly noSkip?: boolean;
}

export type GateFailure =
  | { readonly kind: "not_a_repo" }
  | { readonly kind: "no_tree_hash" }
  | { readonly kind: "contract"; readonly problem: LoadProblem };

export type GateSkip = "no_repo" | "no_changes" | "no_session_edits";

export interface Prepared {
  readonly ctx: GateContext;
  readonly loaded: LoadedContract;
}

const diskFiles = (runtime: Runtime, root: AbsolutePath): ProjectFiles => ({
  read: (relative) => {
    const text = runtime.readText(toAbsolutePath(join(root, relative)));
    return text.ok ? text.value : undefined;
  },
  exists: (relative) => runtime.stat(toAbsolutePath(join(root, relative))) !== undefined,
});

const baseFiles = (git: Git, base: string, disk: ProjectFiles): ProjectFiles => ({
  read: (relative) => (base === EMPTY_TREE ? disk.read(relative) : fileAt(git, base, relative)),
  exists: disk.exists,
});

const loadContract = (
  options: GateOptions,
  paths: FmPaths,
  git: Git,
  base: string,
): Parsed<LoadedContract, LoadProblem> => {
  const disk = diskFiles(options.runtime, paths.root);
  const id = activeTaskId(options.runtime, paths, options.taskId);
  if (id === undefined) return accept(loadImplicit(options.runtime, paths, baseFiles(git, base, disk)));
  return loadTask(options.runtime, paths, { disk: disk.read, base: (relative) => fileAt(git, base, relative) }, id);
};

const memo = <T>(make: () => T): (() => T) => {
  let value: { readonly v: T } | undefined;
  return () => {
    value ??= { v: make() };
    return value.v;
  };
};

const sessionBaseline = (runtime: Runtime, paths: FmPaths, sessionId: string | undefined): Baseline | undefined => {
  const session = readSession(runtime, paths);
  const baseline = readBaseline(runtime, paths);
  if (session === undefined || baseline === undefined) return undefined;
  if (sessionId !== undefined && session.sessionId !== sessionId) return undefined;
  return baseline.treeHash === session.startTree ? baseline.checks : undefined;
};

export const skipReason = (
  runtime: Runtime,
  paths: FmPaths,
  loaded: LoadedContract,
  changes: readonly Change[],
  tree: string,
  sessionId: string | undefined,
): GateSkip | undefined => {
  if (!loaded.contract.implicit) return undefined;
  if (changes.length === 0) return "no_changes";
  const session = readSession(runtime, paths);
  return session !== undefined && session.sessionId === sessionId && session.startTree === tree
    ? "no_session_edits"
    : undefined;
};

export type PrepareResult =
  | { readonly kind: "ready"; readonly prepared: Prepared }
  | { readonly kind: "skipped"; readonly reason: GateSkip }
  | { readonly kind: "failed"; readonly failure: GateFailure };

export const prepareGate = (options: GateOptions): PrepareResult => {
  const probe = gitAt(options.runtime, options.cwd);
  const root = gitRoot(probe);
  if (root === undefined) {
    return options.taskId === undefined
      ? { kind: "skipped", reason: "no_repo" }
      : { kind: "failed", failure: { kind: "not_a_repo" } };
  }
  const git = gitAt(options.runtime, root);
  const paths = fmPaths(root);
  const trust: GateTrust = readTrust(options.runtime, paths);
  const firstBase = resolveBase(git, undefined);
  const loaded = loadContract(options, paths, git, firstBase);
  if (!loaded.ok) return { kind: "failed", failure: { kind: "contract", problem: loaded.error } };
  const base = resolveBase(git, loaded.value.contract.base);
  const changes = changedFiles(git, base);
  const tree = treeHash(git);
  if (tree === undefined) return { kind: "failed", failure: { kind: "no_tree_hash" } };
  const skip =
    options.noSkip === true
      ? undefined
      : skipReason(options.runtime, paths, loaded.value, changes, tree, options.sessionId);
  if (skip !== undefined) return { kind: "skipped", reason: skip };
  const pr = memo((): PrStatus => prStatus(options.runtime, git, paths));
  const ctx: GateContext = {
    runtime: options.runtime,
    git,
    paths,
    contract: loaded.value.contract,
    trusted: loaded.value.trusted,
    treeHash: tree,
    base,
    changes,
    deadline: nowMs(options.runtime) + options.budgetMs,
    sessionId: options.sessionId,
    env: options.env,
    trust,
    pr,
    mask: options.mask ?? maskText,
    baseline: sessionBaseline(options.runtime, paths, options.sessionId),
  };
  return { kind: "ready", prepared: { ctx, loaded: loaded.value } };
};
