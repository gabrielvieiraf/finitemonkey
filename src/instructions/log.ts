import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { type JsonObject, parseJsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { projectPaths } from "../gate/hooks/common.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { LOAD_REASONS, type LoadReason } from "./types.js";

export const INSTRUCTIONS_LOG = "instructions.jsonl";

export interface LoadRecord {
  readonly at: string;
  readonly session: string;
  readonly file: string;
  readonly reason: LoadReason;
  readonly memoryType: string;
  readonly trigger: string | undefined;
  readonly parent: string | undefined;
}

export const instructionsLog = (dir: AbsolutePath): AbsolutePath => toAbsolutePath(join(dir, INSTRUCTIONS_LOG));

const reasonOf = (value: string | undefined): LoadReason | undefined => LOAD_REASONS.find((reason) => reason === value);

const text = (raw: JsonObject, key: string): string | undefined => {
  const value = raw[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

export const parseRecord = (raw: JsonObject): LoadRecord | undefined => {
  const file = text(raw, "file");
  const reason = reasonOf(text(raw, "reason"));
  if (file === undefined || reason === undefined) return undefined;
  return {
    at: text(raw, "at") ?? "",
    session: text(raw, "session") ?? "",
    file,
    reason,
    memoryType: text(raw, "memoryType") ?? "",
    trigger: text(raw, "trigger"),
    parent: text(raw, "parent"),
  };
};

export const readLoadRecords = (runtime: Pick<Runtime, "readText">, dir: AbsolutePath): readonly LoadRecord[] => {
  const raw = runtime.readText(instructionsLog(dir));
  if (!raw.ok) return [];
  return raw.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const record = parsed?.ok === true ? parseRecord(parsed.value) : undefined;
    return record === undefined ? [] : [record];
  });
};

const ALLOW = { kind: "allow" } as const;

const absolute = (path: string | undefined, cwd: AbsolutePath): string | undefined =>
  path === undefined || path === "" ? undefined : toPosixPath(toAbsolutePath(path, cwd));

export const instructionsLoaded: HookHandler = (input) => {
  const paths = projectPaths(input);
  const raw = input.payload.raw;
  const file = absolute(textField(raw, "file_path"), input.cwd);
  if (paths === undefined || file === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return ALLOW;
  const record = {
    at: input.runtime.now(),
    session: input.payload.sessionId ?? "",
    file,
    reason: reasonOf(textField(raw, "load_reason")) ?? "session_start",
    memoryType: textField(raw, "memory_type") ?? "",
    trigger: absolute(textField(raw, "trigger_file_path"), input.cwd),
    parent: absolute(textField(raw, "parent_file_path"), input.cwd),
  };
  input.runtime.appendText(instructionsLog(paths.dir), `${JSON.stringify(record)}\n`);
  return ALLOW;
};
