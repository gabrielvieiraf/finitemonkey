import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type Change, type Git, numstat } from "./git.js";
import type { DiffShape } from "./size.js";

export const untrackedLines = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  changes: readonly Change[],
): number =>
  changes
    .filter((change) => change.status === "A")
    .reduce((sum, change) => {
      const text = runtime.readText(toAbsolutePath(join(root, change.path)));
      return sum + (text.ok ? text.value.split("\n").length : 0);
    }, 0);

export const diffShape = (
  runtime: Pick<Runtime, "readText">,
  git: Git,
  base: string,
  changes: readonly Change[],
): DiffShape => ({
  files: changes.map((change) => change.path),
  lines: numstat(git, base).lines + untrackedLines(runtime, git.cwd, changes),
});
