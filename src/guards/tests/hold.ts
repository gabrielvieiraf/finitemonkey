import { join, relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { matchesAny } from "../../core/glob.js";
import { toPosixPath } from "../../core/posix-path.js";
import type { Runtime } from "../../core/runtime.js";
import { logEvent } from "../../evidence/log.js";
import { projectPaths } from "../../gate/hooks/common.js";
import { textField, toolInput, toolName } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { loadTask } from "../../task/load.js";
import type { FmPaths } from "../../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../../task/state.js";
import type { TaskScope } from "../../task/types.js";
import { deny, grantFor, guardRoot } from "../context.js";
import { isSnapshot, isTestFile } from "./patterns.js";

export const TESTS_HOLD_GUARD = "tests-hold";
const CREATED_FILE = "tests-created.json";
const WRITERS = new Set(["Write", "Edit", "MultiEdit"]);
const ALLOW: HookDecision = { kind: "allow" };

export const isListed = (scope: Pick<TaskScope, "paths" | "testsProtected">, file: string): boolean =>
  !scope.testsProtected || (scope.paths.length > 0 && matchesAny(file, scope.paths));

const activeScope = (runtime: Runtime, paths: FmPaths): TaskScope | undefined => {
  const active = readState(runtime, paths).active;
  if (active === undefined) return undefined;
  const disk = (file: string): string | undefined => {
    const text = runtime.readText(toAbsolutePath(join(paths.root, file)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(runtime, paths, { disk, base: () => undefined }, active);
  return loaded.ok ? loaded.value.contract.scope : undefined;
};

const createdFiles = (runtime: Runtime, paths: FmPaths): readonly string[] => {
  const list = readJsonFile(runtime, paths.cache(CREATED_FILE))?.["files"];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
};

const remember = (runtime: Runtime, paths: FmPaths, file: string): void => {
  const files = [...new Set([...createdFiles(runtime, paths), file])].slice(-200);
  writeJsonFile(runtime, paths.cache(CREATED_FILE), { files });
};

const target = (root: AbsolutePath, raw: string): string => toPosixPath(relative(root, toAbsolutePath(raw, root)));

export const testEditHold: HookHandler = (input) => {
  if (!WRITERS.has(toolName(input.payload.raw))) return ALLOW;
  const raw = textField(toolInput(input.payload.raw), "file_path") ?? "";
  const root = guardRoot(input);
  const file = target(root, raw);
  const paths = projectPaths(input);
  if (raw === "" || paths === undefined || !isTestFile(file) || isSnapshot(file)) return ALLOW;
  const { runtime, t } = input;
  if (runtime.stat(toAbsolutePath(raw, root)) === undefined) {
    remember(runtime, paths, file);
    return ALLOW;
  }
  const scope = activeScope(runtime, paths);
  if (createdFiles(runtime, paths).includes(file) || (scope !== undefined && isListed(scope, file))) return ALLOW;
  if (grantFor(input, "tests") !== undefined) {
    logEvent(runtime, paths, "tests.edit_released", { file });
    return ALLOW;
  }
  logEvent(runtime, paths, "tests.edit_held", { file });
  const reason = modelReason(t, "gate.guard.tests.held", { file });
  return { ...deny(reason, t("gate.guard.held.human", { file })), warning: `finitemonkey: ${reason}` };
};

export const TESTS_HOLD_HANDLERS: HookHandlers = { PreToolUse: [testEditHold] };
