import { nowMs } from "../core/clock.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler, HookInput } from "../hooks/handlers.js";
import { baseOf, record, scopeOf, type SignalScope } from "../signals/context.js";
import { cappedHashes } from "../signals/line-hashes.js";
import { shortHash } from "../signals/signature.js";
import type { FmPaths } from "../task/paths.js";
import { addedHashes, changedPaths, type PathMark, takeSnapshot, type TreeSnapshot } from "./fingerprint.js";

export const SHELL_WRITERS = new Set(["Bash", "PowerShell"]);
export const MAX_RECORDED_FILES = 200;
const SNAPSHOT_PREFIX = "bash-before-";

const allow = { kind: "allow" } as const;

const snapshotKey = (input: HookInput): string => {
  const raw = input.payload.raw;
  const id = textField(raw, "tool_use_id");
  const command = textField(toolInput(raw), "command") ?? "";
  return shortHash(id !== undefined && id !== "" ? id : `${input.payload.sessionId ?? ""}\0${command}`);
};

const snapshotFile = (paths: FmPaths, input: HookInput): ReturnType<FmPaths["cache"]> =>
  paths.cache(`${SNAPSHOT_PREFIX}${snapshotKey(input)}.json`);

const markOf = (value: unknown): PathMark | undefined => {
  if (!isRecord(value)) return undefined;
  const { status, size, mtime } = value;
  return typeof status === "string" && typeof size === "number" && typeof mtime === "number"
    ? { status, size, mtime }
    : undefined;
};

const linesOf = (value: unknown): Record<string, readonly string[]> | null => {
  if (!isRecord(value)) return null;
  const lines: Record<string, readonly string[]> = {};
  for (const [path, list] of Object.entries(value))
    lines[path] = Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  return lines;
};

export const parseSnapshot = (raw: JsonObject): TreeSnapshot | undefined => {
  const marks = raw["marks"];
  if (!isRecord(marks)) return undefined;
  const parsed: Record<string, PathMark> = {};
  for (const [path, value] of Object.entries(marks)) {
    const mark = markOf(value);
    if (mark !== undefined) parsed[path] = mark;
  }
  return { marks: parsed, lines: linesOf(raw["lines"]) };
};

const STALE_MS = 3_600_000;

const pruneStale = (input: HookInput, paths: FmPaths): void => {
  const dir = paths.cache("");
  const listed = input.runtime.listDir(dir);
  if (!listed.ok) return;
  const cutoff = nowMs(input.runtime) - STALE_MS;
  for (const name of listed.value) {
    if (!name.startsWith(SNAPSHOT_PREFIX)) continue;
    const file = paths.cache(name);
    if ((input.runtime.stat(file)?.mtimeMs ?? 0) < cutoff) input.runtime.remove(file);
  }
};

export const bashSnapshot: HookHandler = (input) => {
  if (!SHELL_WRITERS.has(toolName(input.payload.raw))) return allow;
  const scope = scopeOf(input);
  if (scope === undefined) return allow;
  pruneStale(input, scope.paths);
  const snapshot = takeSnapshot(input.runtime, scope.paths.root, true);
  if (snapshot !== undefined)
    input.runtime.writeText(
      snapshotFile(scope.paths, input),
      JSON.stringify({ marks: snapshot.marks, lines: snapshot.lines }),
    );
  return allow;
};

const readSnapshot = (input: HookInput, scope: SignalScope): TreeSnapshot | undefined => {
  const file = snapshotFile(scope.paths, input);
  const text = input.runtime.readText(file);
  if (!text.ok) return undefined;
  input.runtime.remove(file);
  const parsed = parseJsonObject(text.value);
  return parsed.ok ? parseSnapshot(parsed.value) : undefined;
};

const agentLines = (before: TreeSnapshot, path: string, now: readonly string[]): readonly string[] | undefined => {
  if (before.marks[path] === undefined) return cappedHashes(now);
  if (before.lines === null) return undefined;
  const earlier = new Set(before.lines[path] ?? []);
  return cappedHashes(now.filter((hash) => !earlier.has(hash)));
};

const statusMap = (snapshot: TreeSnapshot): ReadonlyMap<string, string> =>
  new Map(Object.entries(snapshot.marks).map(([path, mark]) => [path, mark.status]));

export const bashWriteRecorder: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  if (!SHELL_WRITERS.has(tool)) return allow;
  const scope = scopeOf(input);
  if (scope === undefined) return allow;
  const before = readSnapshot(input, scope);
  const after = before === undefined ? undefined : takeSnapshot(input.runtime, scope.paths.root, false);
  if (before === undefined || after === undefined) return allow;
  const changed = changedPaths(before, after).slice(0, MAX_RECORDED_FILES);
  const present = changed.filter((path) => (after.marks[path]?.size ?? -1) >= 0);
  const now = present.length === 0 ? {} : addedHashes(input.runtime, scope.paths.root, statusMap(after), present);
  changed.reduce((current, file) => {
    const lines = agentLines(before, file, now[file] ?? []);
    return record(current, {
      ...baseOf(current),
      kind: "bash_write",
      file,
      tool,
      ...(lines === undefined ? {} : { lines }),
    });
  }, scope);
  return allow;
};
