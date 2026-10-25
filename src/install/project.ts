import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export type ProjectRuntime = Pick<
  Runtime,
  "readText" | "stat" | "listDir" | "writeAtomic" | "rename" | "mkdir" | "remove" | "lock" | "now" | "probe"
>;

export interface Project {
  readonly root: AbsolutePath;
  readonly runtime: ProjectRuntime;
  readonly abs: (relative: string) => AbsolutePath;
  readonly read: (relative: string) => string | undefined;
  readonly exists: (relative: string) => boolean;
  readonly isDir: (relative: string) => boolean;
}

export const projectAt = (root: AbsolutePath, runtime: ProjectRuntime): Project => {
  const abs = (relative: string): AbsolutePath => toAbsolutePath(join(root, ...relative.split("/")));
  return {
    root,
    runtime,
    abs,
    read: (relative) => {
      const text = runtime.readText(abs(relative));
      return text.ok ? text.value : undefined;
    },
    exists: (relative) => runtime.stat(abs(relative)) !== undefined,
    isDir: (relative) => runtime.stat(abs(relative))?.kind === "dir",
  };
};

export const findGitRoot = (start: AbsolutePath, runtime: Pick<Runtime, "stat">): AbsolutePath | undefined => {
  let current: string = start;
  for (;;) {
    if (runtime.stat(toAbsolutePath(join(current, ".git"))) !== undefined) return toAbsolutePath(current);
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};
