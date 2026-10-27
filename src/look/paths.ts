import { join, relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import type { FmPaths } from "../task/paths.js";

export const LOOK_DIR = "look";
export const SUMMARY_FILE = "summary.json";

export const lookDir = (paths: FmPaths, treeHash: string): AbsolutePath =>
  toAbsolutePath(join(paths.dir, LOOK_DIR, treeHash));

export const summaryPath = (paths: FmPaths, treeHash: string): AbsolutePath =>
  toAbsolutePath(join(lookDir(paths, treeHash), SUMMARY_FILE));

export const projectRelative = (paths: FmPaths, absolute: string): string =>
  toPosixPath(relative(paths.root, absolute));
