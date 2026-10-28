import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot, sessionCwd } from "../gate/hooks/common.js";
import { configAt, type ConfigTree, loadProjectConfig } from "../git/project-config.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { newWorktree } from "./create.js";
import { gitWorktrees } from "./git-list.js";
import { hookOwner } from "./hooks.js";
import { defaultPlace, OFFICIAL_DIR } from "./place.js";
import { portBaseOf } from "./ports.js";

export const WT_PLACE_FEATURE = "wt-place";
export const WORKTREE_PATH = "worktreePath";
const MAX_ID = 64;

export const worktreeId = (raw: string): string =>
  raw
    .replace(/^worktree-/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, MAX_ID);

const configText = (tree: ConfigTree, ...path: readonly string[]): string | undefined => {
  const node = configAt(tree, ...path);
  return typeof node === "string" ? node : undefined;
};

const created = (path: string): HookDecision => ({ kind: "allow", output: { [WORKTREE_PATH]: path } });

const failed = (detail: string): HookDecision => ({ kind: "block", reason: `WorktreeCreate: ${detail}` });

const mainRootOf = (input: HookInput, cwd: AbsolutePath): AbsolutePath | undefined => {
  const main = gitWorktrees(input.runtime, cwd)?.find((tree) => tree.main);
  return main === undefined ? undefined : toAbsolutePath(main.path);
};

const plainAdd = (input: HookInput, root: AbsolutePath, id: string, branch: string): HookDecision => {
  const path = toAbsolutePath(join(root, OFFICIAL_DIR, id));
  const result = input.runtime.gitWith(["worktree", "add", "-b", branch, path, "HEAD"], root, {});
  return result.ok ? created(path) : failed(result.stderr.trim());
};

const placed = (input: HookInput, cwd: AbsolutePath, id: string, branch: string): HookDecision => {
  const made = newWorktree(input.runtime, cwd, input.env, {
    id,
    purpose: "Claude Code worktree",
    base: undefined,
    branch,
    path: undefined,
    task: undefined,
    parent: undefined,
    portBase: portBaseOf(configText(loadProjectConfig(input.runtime, cwd), "ports", "base")),
    owner: hookOwner(input.payload),
    unlocked: true,
  });
  return made.ok ? created(made.value.path) : failed(JSON.stringify(made.error));
};

export const worktreeCreate: HookHandler = (input) => {
  const repo = textField(input.payload.raw, "repo_path");
  const cwd = repo === undefined ? sessionCwd(input) : toAbsolutePath(repo, input.cwd);
  const root = mainRootOf(input, cwd);
  if (root === undefined) return failed(`not a git repository: ${cwd}`);
  const requested = textField(input.payload.raw, "name") ?? textField(input.payload.raw, "branch") ?? "";
  const id = worktreeId(requested);
  if (id === "") return failed("no worktree name or branch in the payload");
  const branch = textField(input.payload.raw, "branch") ?? `worktree-${id}`;
  const paths = fmPaths(findRepoRoot(input.runtime, root) ?? root);
  const mode = featureMode(input.runtime, paths, WT_PLACE_FEATURE);
  const proposed = defaultPlace(root, input.runtime.homeDir(), id);
  logEvent(input.runtime, paths, "wt.placed", { id, proposed, mode });
  return mode === "active" ? placed(input, cwd, id, branch) : plainAdd(input, root, id, branch);
};

export const worktreeRemove: HookHandler = (input) => {
  const target = textField(input.payload.raw, "worktree_path");
  if (target === undefined) return { kind: "allow" };
  const repo = textField(input.payload.raw, "repo_path");
  const cwd = repo === undefined ? sessionCwd(input) : toAbsolutePath(repo, input.cwd);
  const result = input.runtime.gitWith(["worktree", "remove", target], cwd, {});
  return result.ok ? { kind: "allow" } : failed(result.stderr.trim());
};

export const WT_PLACE_HANDLERS: HookHandlers = { WorktreeCreate: [worktreeCreate], WorktreeRemove: [worktreeRemove] };
