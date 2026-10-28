import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { logEvent } from "../evidence/log.js";
import { human, projectPaths } from "../gate/hooks/common.js";
import type { HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { cleanableOf, dismissedCount, markStarted, readClasses, refreshDue } from "./suggest.js";

export const WT_SUGGEST_FEATURE = "wt-suggest";
const MEGABYTE = 1_048_576;

const allow = { kind: "allow" } as const;

const projectOf = (input: HookInput): FmPaths | undefined => {
  const paths = projectPaths(input);
  return paths !== undefined && input.runtime.stat(paths.dir)?.kind === "dir" ? paths : undefined;
};

const hasWorktrees = (input: HookInput, paths: FmPaths): boolean => {
  const git = input.runtime.stat(toAbsolutePath(join(paths.root, ".git")))?.kind;
  return git === "file" || input.runtime.stat(toAbsolutePath(join(paths.root, ".git", "worktrees")))?.kind === "dir";
};

export const wtClassifyStop: HookHandler = (input) => {
  const paths = projectOf(input);
  if (paths === undefined || !hasWorktrees(input, paths)) return allow;
  if (!refreshDue(input.runtime, readClasses(input.runtime, paths))) return allow;
  markStarted(input.runtime, paths);
  input.runtime.spawnSelf(["wt", "classify"], paths.root);
  return allow;
};

export const wtSuggestStart: HookHandler = (input) => {
  const paths = projectOf(input);
  if (paths === undefined) return allow;
  const { runtime, t } = input;
  const cached = readClasses(runtime, paths);
  if (cached === undefined) return allow;
  const cleanable = cleanableOf(cached);
  if (cleanable.count === 0 || cleanable.count <= dismissedCount(runtime, paths)) return allow;
  const mode = featureMode(runtime, paths, WT_SUGGEST_FEATURE);
  logEvent(runtime, paths, "wt.suggested", { count: cleanable.count, bytes: cleanable.bytes, mode });
  if (mode !== "active") {
    recordFeatureShadow(runtime, paths, WT_SUGGEST_FEATURE, { count: cleanable.count });
    return allow;
  }
  const size = (cleanable.bytes / MEGABYTE).toFixed(0);
  return { kind: "allow", output: { systemMessage: human(t("wt.suggest.line", { count: cleanable.count, size })) } };
};

export const WT_SUGGEST_HANDLERS: HookHandlers = { SessionStart: [wtSuggestStart], Stop: [wtClassifyStop] };
