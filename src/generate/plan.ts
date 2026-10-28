import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { lineDiff } from "../install/diff.js";

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

export type FileStatus = "new" | "same" | "differs";

export interface PlannedFile {
  readonly path: string;
  readonly status: FileStatus;
  readonly diff: readonly string[];
}

export interface Applied {
  readonly written: readonly string[];
  readonly proposed: readonly string[];
}

const target = (root: AbsolutePath, path: string): AbsolutePath => toAbsolutePath(join(root, path));

export const planFiles = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  files: readonly GeneratedFile[],
): readonly PlannedFile[] =>
  files.map((file) => {
    const current = runtime.readText(target(root, file.path));
    if (!current.ok) return { path: file.path, status: "new", diff: [] };
    if (current.value === file.content) return { path: file.path, status: "same", diff: [] };
    return { path: file.path, status: "differs", diff: lineDiff(file.path, current.value, file.content) };
  });

export const applyFiles = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  root: AbsolutePath,
  files: readonly GeneratedFile[],
  overwrite: boolean,
): Applied => {
  const plan = planFiles(runtime, root, files);
  const written: string[] = [];
  const proposed: string[] = [];
  for (const [index, item] of plan.entries()) {
    const file = files[index];
    if (file === undefined || item.status === "same") continue;
    if (item.status === "differs" && !overwrite) {
      proposed.push(item.path);
      continue;
    }
    runtime.mkdir(toAbsolutePath(dirname(target(root, file.path))));
    if (runtime.writeText(target(root, file.path), file.content).ok) written.push(file.path);
  }
  return { written, proposed };
};
