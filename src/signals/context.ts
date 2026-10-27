import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { projectPaths } from "../gate/hooks/common.js";
import { readGateStatus } from "../gate/hooks/status.js";
import type { HookInput } from "../hooks/handlers.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { computeIndex, type LoopIndex, thresholdsOf } from "./loop-index.js";
import { shortHash } from "./signature.js";
import {
  appendEntry,
  readEntries,
  readProfile,
  sessionEntries,
  type SignalEntry,
  type SignalFiles,
  signalFiles,
  turnOf,
} from "./store.js";

export interface SignalScope {
  readonly input: HookInput;
  readonly paths: FmPaths;
  readonly files: SignalFiles;
  readonly session: string;
  readonly entries: readonly SignalEntry[];
  readonly turn: number;
}

export const scopeOf = (input: HookInput): SignalScope | undefined => {
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return undefined;
  const files = signalFiles(paths);
  const entries = readEntries(input.runtime, files);
  const session = input.payload.sessionId ?? "";
  return { input, paths, files, session, entries, turn: turnOf(entries, session) };
};

export const record = (scope: SignalScope, entry: SignalEntry): SignalScope => ({
  ...scope,
  entries: appendEntry(scope.input.runtime, scope.files, entry, scope.entries),
});

export const baseOf = (
  scope: SignalScope,
): { readonly at: string; readonly session: string; readonly turn: number } => ({
  at: scope.input.runtime.now(),
  session: scope.session,
  turn: scope.turn,
});

export const projectFile = (scope: SignalScope, file: string): string =>
  toPosixPath(relative(scope.paths.root, toAbsolutePath(file, scope.paths.root)));

export const progressKey = (scope: SignalScope): string => {
  const { runtime } = scope.input;
  const active = readState(runtime, scope.paths).active;
  if (active === undefined) return "";
  const status = readGateStatus(runtime, scope.paths);
  if (status?.task !== active) return shortHash(`${active}|none`);
  return status.status === "passed" ? "" : shortHash(`${active}|${status.status}|${status.detail}`);
};

const gateFailedAt = (scope: SignalScope): string | undefined => {
  const status = readGateStatus(scope.input.runtime, scope.paths);
  return status?.status === "failed" ? status.at : undefined;
};

export const indexOf = (scope: SignalScope): LoopIndex =>
  computeIndex(
    sessionEntries(scope.entries, scope.session),
    thresholdsOf(readProfile(scope.input.runtime, scope.files)),
    gateFailedAt(scope),
  );
