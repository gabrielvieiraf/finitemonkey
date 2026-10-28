import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { findRepoRoot, sessionCwd } from "../gate/hooks/common.js";
import { readGateStatus } from "../gate/hooks/status.js";
import type { HookInput } from "../hooks/handlers.js";
import { readIndexFile, recordOf, signalFiles } from "../signals/store.js";
import { loadTask } from "../task/load.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import type { AcceptanceCheck } from "../task/types.js";

export interface TaskInView {
  readonly paths: FmPaths;
  readonly task: string;
  readonly checks: readonly AcceptanceCheck[];
  readonly closing: boolean;
}

const number = (value: unknown): number => (typeof value === "number" ? value : 0);

export const judgmentSignal = (input: HookInput, paths: FmPaths): boolean => {
  const raw = readIndexFile(input.runtime, signalFiles(paths));
  if (input.payload.sessionId !== undefined && raw["session"] !== input.payload.sessionId) return false;
  const index = recordOf(raw["index"]);
  return index["frontier"] === "judgment" || number(index["fastAccepts"]) + number(index["caughtAfterApproval"]) > 0;
};

const taskId = (input: HookInput, paths: FmPaths): { readonly task: string; readonly closing: boolean } | undefined => {
  const status = readGateStatus(input.runtime, paths);
  const active = readState(input.runtime, paths).active;
  if (active !== undefined) return { task: active, closing: status?.status === "passed" && status.task === active };
  return status?.status === "passed" ? { task: status.task, closing: true } : undefined;
};

export const taskInView = (input: HookInput): TaskInView | undefined => {
  const root = findRepoRoot(input.runtime, sessionCwd(input));
  if (root === undefined) return undefined;
  const paths = fmPaths(root);
  const found = taskId(input, paths);
  if (found === undefined) return undefined;
  const disk = (relative: string): string | undefined => {
    const text = input.runtime.readText(toAbsolutePath(join(root, relative)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(input.runtime, paths, { disk, base: () => undefined }, found.task);
  if (!loaded.ok) return undefined;
  return { paths, task: found.task, checks: loaded.value.contract.acceptance, closing: found.closing };
};
