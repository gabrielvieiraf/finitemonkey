import { isAbsolute, relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import { toPosixPath } from "../core/posix-path.js";
import { logEvent } from "../evidence/log.js";
import { readFronts } from "../fronts/state.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { deny, FILE_TOOLS, guardRoot } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { featureMode } from "../policy/feature.js";
import { IMPLICIT_ID } from "./implicit.js";
import type { FmPaths } from "./paths.js";
import { observeEdit, readInferred, scopeLabel, writeInferred } from "./scope-infer.js";
import { readState } from "./state.js";

export const SCOPE_GUARD = "scope";
export const FRONT_SCOPE_GUARD = "front-scope";

const allow = { kind: "allow" } as const;

const targetOf = (input: HookInput): string | undefined => {
  const raw = input.payload.raw;
  return FILE_TOOLS.has(toolName(raw)) ? textField(toolInput(raw), "file_path", "notebook_path") : undefined;
};

const inside = (root: string, target: string): string | undefined => {
  const rel = relative(root, toAbsolutePath(target, toAbsolutePath(root)));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const posix = toPosixPath(rel);
  return posix.startsWith(".finitemonkey/") || posix.startsWith(".git/") ? undefined : posix;
};

const advise = (
  input: HookInput,
  paths: FmPaths,
  event: "widened" | "outside",
  params: Record<string, string>,
): HookDecision => {
  const mode = featureMode(input.runtime, paths, SCOPE_GUARD);
  logEvent(input.runtime, paths, `scope.${event}`, { ...params, mode });
  if (mode !== "active") return allow;
  return { kind: "allow", output: contextOutput(input.event, input.t(`scope.${event}`, params)) };
};

export const scopeAfterEdit: HookHandler = (input) => {
  const target = targetOf(input);
  const paths = projectPaths(input);
  if (target === undefined || paths === undefined) return allow;
  if (readState(input.runtime, paths).active !== undefined) return allow;
  const file = inside(paths.root, target);
  if (file === undefined) return allow;
  const before = readInferred(input.runtime, paths);
  const { scope, event } = observeEdit(before, IMPLICIT_ID, file);
  if (scope !== before) writeInferred(input.runtime, paths, scope);
  if (event === "widened") return advise(input, paths, "widened", { file, scope: scopeLabel(scope) });
  if (event === "outside") return advise(input, paths, "outside", { file, scope: scopeLabel(scope) });
  return allow;
};

export const frontScopeGuard: HookHandler = (input) => {
  const target = targetOf(input);
  if (target === undefined) return allow;
  const root = guardRoot(input);
  const state = readFronts(input.runtime, root);
  if (!state.ok) return allow;
  for (const front of state.value.fronts) {
    if (front.path === null || front.paths.length === 0 || front.status !== "running") continue;
    const file = inside(toAbsolutePath(front.path, root), target);
    if (file === undefined || matchesAny(file, [...front.paths, ...front.append])) continue;
    const params = { front: front.id, file, paths: front.paths.join(", ") };
    return deny(modelReason(input.t, "fronts.scope", params), input.t("fronts.scope.human", params));
  }
  return allow;
};
