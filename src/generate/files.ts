import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { lineDiff } from "../install/diff.js";

export interface GenFile {
  readonly path: string;
  readonly text: string;
  readonly merge?: (current: string) => string | undefined;
}

export const GEN_STATUSES = ["create", "same", "merge", "differs"] as const;

export type GenStatus = (typeof GEN_STATUSES)[number];

export interface GenEntry {
  readonly path: string;
  readonly status: GenStatus;
  readonly diff: readonly string[];
}

export interface PlannedFile extends GenEntry {
  readonly text: string;
  readonly before: string;
}

export type GenRuntime = Pick<Runtime, "readText" | "writeText" | "mkdir">;

const absolute = (root: AbsolutePath, path: string): AbsolutePath => toAbsolutePath(join(root, ...path.split("/")));

const normalized = (text: string): string => text.replace(/\r\n/g, "\n");

export type Formatter = (path: string, text: string) => string;

const asIs: Formatter = (_path, text) => text;

const planOne = (runtime: GenRuntime, root: AbsolutePath, file: GenFile, format: Formatter): PlannedFile => {
  const current = runtime.readText(absolute(root, file.path));
  const text = format(file.path, file.text);
  if (!current.ok) return { path: file.path, status: "create", diff: lineDiff(file.path, "", text), text, before: "" };
  const before = normalized(current.value);
  const kept = { path: file.path, diff: [], text: before, before };
  if (before === normalized(text)) return { ...kept, status: "same" };
  const raw = file.merge?.(before);
  if (raw === undefined) return { ...kept, status: "differs", diff: lineDiff(file.path, before, text) };
  const merged = format(file.path, raw);
  if (normalized(merged) === before) return { ...kept, status: "same" };
  return { path: file.path, status: "merge", diff: lineDiff(file.path, before, merged), text: merged, before };
};

export const planFiles = (
  runtime: GenRuntime,
  root: AbsolutePath,
  files: readonly GenFile[],
  format: Formatter = asIs,
): readonly PlannedFile[] => files.map((file) => planOne(runtime, root, file, format));

export const writable = (entry: GenEntry): boolean => entry.status === "create" || entry.status === "merge";

export const writeFiles = (
  runtime: GenRuntime,
  root: AbsolutePath,
  entries: readonly PlannedFile[],
): Parsed<readonly string[]> => {
  const written: string[] = [];
  for (const entry of entries.filter(writable)) {
    const target = absolute(root, entry.path);
    const made = runtime.mkdir(toAbsolutePath(dirname(target)));
    if (!made.ok) return made;
    const saved = runtime.writeText(target, entry.text);
    if (!saved.ok) return saved;
    written.push(entry.path);
  }
  return accept(written);
};
