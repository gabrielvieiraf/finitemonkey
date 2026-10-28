import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import type { WorktreeEntry, WorktreeOwner } from "./entry.js";
import { gitWorktrees } from "./git-list.js";
import { defaultPlace, isWithinPath, OFFICIAL_DIR, type PlaceProblem, placeProblems, tempDirs } from "./place.js";
import { allocatePorts } from "./ports.js";
import { commonDirOf, type Registry, updateRegistry, upsertEntry } from "./store.js";

export interface NewWorktree {
  readonly id: string;
  readonly purpose: string;
  readonly base: string | undefined;
  readonly branch: string | undefined;
  readonly path: string | undefined;
  readonly task: string | undefined;
  readonly parent: string | undefined;
  readonly portBase: number;
  readonly owner: WorktreeOwner;
  readonly unlocked?: boolean;
}

export type NewFailure =
  | { readonly kind: "not-repo" }
  | { readonly kind: "bad-id"; readonly id: string }
  | { readonly kind: "taken"; readonly id: string }
  | { readonly kind: "place"; readonly path: string; readonly problems: readonly PlaceProblem[] }
  | { readonly kind: "no-ports" }
  | { readonly kind: "git"; readonly detail: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const LOCK_REASON_PREFIX = "finitemonkey:";

const line = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, cwd);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const ensureIgnored = (runtime: Runtime, mainRoot: AbsolutePath, commonDir: AbsolutePath): void => {
  if (runtime.git(["check-ignore", "-q", `${OFFICIAL_DIR}/x`], mainRoot).ok) return;
  const exclude = toAbsolutePath(join(commonDir, "info", "exclude"));
  runtime.mkdir(toAbsolutePath(join(commonDir, "info")));
  runtime.appendText(exclude, `\n/${OFFICIAL_DIR}/\n`);
};

const gitStep = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[]): Parsed<undefined, NewFailure> => {
  const result = runtime.gitWith(args, cwd, {});
  return result.ok
    ? accept(undefined)
    : reject({ kind: "git", detail: `git ${args.slice(0, 2).join(" ")}: ${result.stderr.trim()}` });
};

interface Planned {
  readonly request: NewWorktree;
  readonly mainRoot: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly path: AbsolutePath;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly branch: string;
}

const entryOf = (runtime: Runtime, plan: Planned, ports: WorktreeEntry["ports"]): WorktreeEntry => ({
  id: plan.request.id,
  path: toPosixPath(plan.path),
  branch: plan.branch,
  baseRef: plan.baseRef,
  baseSha: plan.baseSha,
  target: plan.request.parent ?? plan.baseRef,
  owner: plan.request.owner,
  purpose: plan.request.purpose,
  contract: plan.request.task ?? null,
  parent: plan.request.parent ?? null,
  ports,
  pids: [],
  createdAt: runtime.now(),
  activityAt: runtime.now(),
  status: "active",
  pr: null,
  archive: null,
});

const register = (runtime: Runtime, plan: Planned, registry: Registry): Parsed<WorktreeEntry, NewFailure> => {
  if (registry.worktrees.some((item) => item.id === plan.request.id)) {
    return reject({ kind: "taken", id: plan.request.id });
  }
  const ports = allocatePorts(registry.worktrees, plan.request.portBase);
  if (ports === undefined) return reject({ kind: "no-ports" });
  const added = gitStep(runtime, plan.mainRoot, ["worktree", "add", "-b", plan.branch, plan.path, plan.baseSha]);
  if (!added.ok) return added;
  if (plan.request.unlocked === true) return accept(entryOf(runtime, plan, ports));
  const reason = `${LOCK_REASON_PREFIX}${plan.request.id} active`;
  const locked = gitStep(runtime, plan.mainRoot, ["worktree", "lock", "--reason", reason, plan.path]);
  if (!locked.ok) return locked;
  return accept(entryOf(runtime, plan, ports));
};

const planFor = (runtime: Runtime, cwd: AbsolutePath, env: Env, request: NewWorktree): Parsed<Planned, NewFailure> => {
  if (!ID.test(request.id)) return reject({ kind: "bad-id", id: request.id });
  const commonDir = commonDirOf(runtime, cwd);
  const trees = gitWorktrees(runtime, cwd);
  const main = trees?.find((tree) => tree.main);
  if (commonDir === undefined || main === undefined || trees === undefined) return reject({ kind: "not-repo" });
  const mainRoot = toAbsolutePath(main.path);
  const path =
    request.path === undefined
      ? defaultPlace(mainRoot, runtime.homeDir(), request.id)
      : toAbsolutePath(request.path, cwd);
  const linked = trees.filter((tree) => !tree.main).map((tree) => tree.path);
  const problems = placeProblems(path, { mainRoot, temps: tempDirs(env), linked });
  if (problems.length > 0) return reject({ kind: "place", path, problems });
  const baseRef = request.base ?? line(runtime, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? "HEAD";
  const baseSha = line(runtime, cwd, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  if (baseSha === undefined) return reject({ kind: "git", detail: `unknown base ${baseRef}` });
  if (isWithinPath(mainRoot, path)) ensureIgnored(runtime, mainRoot, commonDir);
  return accept({
    request,
    mainRoot,
    commonDir,
    path,
    baseRef,
    baseSha,
    branch: request.branch ?? `agent/${request.id}`,
  });
};

export const newWorktree = (
  runtime: Runtime,
  cwd: AbsolutePath,
  env: Env,
  request: NewWorktree,
): Parsed<WorktreeEntry, NewFailure> => {
  const plan = planFor(runtime, cwd, env, request);
  if (!plan.ok) return plan;
  const done = updateRegistry<WorktreeEntry, NewFailure>(runtime, plan.value.commonDir, request.id, (registry) => {
    const entry = register(runtime, plan.value, registry);
    return entry.ok ? accept({ registry: upsertEntry(registry, entry.value), result: entry.value }) : entry;
  });
  if (done.ok) return done;
  return reject(typeof done.error === "string" ? { kind: "git", detail: done.error } : done.error);
};
