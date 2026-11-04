import { isAbsolute, relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { projectPaths } from "../gate/hooks/common.js";
import { deny, FILE_TOOLS } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { approvedExamples } from "./examples.js";
import { contractHash, parseContract } from "./load.js";
import type { FmPaths } from "./paths.js";
import { readJsonFile, readState, readTrust, writeJsonFile } from "./state.js";
import { TASK_ID } from "./types.js";

export const CONTRACT_HOLD_GUARD = "contract-hold";
export const CONTRACT_HOLD_FILE = "contract-hold.json";

const allow: HookDecision = { kind: "allow" };

const heldFile = (root: string, target: string): string | undefined => {
  const rel = toPosixPath(relative(root, toAbsolutePath(target, toAbsolutePath(root))));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.startsWith(`${DATA_DIR}/`) || rel.startsWith(".git/") ? undefined : rel;
};

export const pendingHash = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): string | undefined => {
  const disk = runtime.readText(paths.task(task));
  if (!disk.ok) return undefined;
  const parsed = parseContract(task, disk.value);
  if (!parsed.ok) return undefined;
  const hash = contractHash(parsed.value, approvedExamples(runtime, paths, task).examples);
  return readTrust(runtime, paths).contracts[task] === hash ? undefined : hash;
};

const alreadyHeld = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string, hash: string): boolean => {
  const saved = readJsonFile(runtime, paths.cache(CONTRACT_HOLD_FILE));
  return saved?.["task"] === task && saved["hash"] === hash;
};

export const contractHold: HookHandler = (input) => {
  const raw = input.payload.raw;
  const target = FILE_TOOLS.has(toolName(raw)) ? textField(toolInput(raw), "file_path", "notebook_path") : undefined;
  const paths = projectPaths(input);
  if (target === undefined || paths === undefined) return allow;
  const file = heldFile(paths.root, target);
  const task = readState(input.runtime, paths).active;
  if (file === undefined || task === undefined || !TASK_ID.test(task)) return allow;
  const hash = pendingHash(input.runtime, paths, task);
  if (hash === undefined || alreadyHeld(input.runtime, paths, task, hash)) return allow;
  writeJsonFile(input.runtime, paths.cache(CONTRACT_HOLD_FILE), { task, hash, at: input.runtime.now() });
  logEvent(input.runtime, paths, "contract.hold", { task, file });
  const params = { task, file };
  return deny(modelReason(input.t, "task.hold", params), input.t("task.hold.human", params));
};

export const CONTRACT_HOLD_HANDLERS: HookHandlers = { PreToolUse: [contractHold] };
