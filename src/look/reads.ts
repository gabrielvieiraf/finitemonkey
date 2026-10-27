import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { projectPaths } from "../gate/hooks/common.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const READS_FILE = "look-reads.json";
const KEEP = 500;

export const readLookReads = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Readonly<Record<string, string>> => {
  const raw = readJsonFile(runtime, paths.cache(READS_FILE))?.["reads"];
  return isRecord(raw)
    ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
};

export const recordLookRead = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  path: string,
): boolean => {
  const entries = Object.entries({ ...readLookReads(runtime, paths), [path]: runtime.now() }).slice(-KEEP);
  return writeJsonFile(runtime, paths.cache(READS_FILE), { reads: Object.fromEntries(entries) }).ok;
};

export const lookCaptureOf = (paths: FmPaths, file: string): string | undefined => {
  const relativePath = toPosixPath(relative(paths.root, toAbsolutePath(file, paths.root)));
  return relativePath.startsWith(".finitemonkey/look/") && relativePath.endsWith(".png") ? relativePath : undefined;
};

export const lookReadTracker: HookHandler = (input) => {
  if (toolName(input.payload.raw) !== "Read") return { kind: "allow" };
  const file = textField(toolInput(input.payload.raw), "file_path");
  const paths = projectPaths(input);
  if (file === undefined || paths === undefined) return { kind: "allow" };
  const capture = lookCaptureOf(paths, file);
  if (capture !== undefined) recordLookRead(input.runtime, paths, capture);
  return { kind: "allow" };
};
