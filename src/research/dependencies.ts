import { toAbsolutePath } from "../core/brand.js";
import { fileAt } from "../gate/git.js";
import type { GateContext } from "../gate/types.js";
import { parseManifest } from "../inventory/dependencies.js";

const MANIFEST = /(^|\/)(package\.json|requirements\.txt|go\.mod)$/;

const namesIn = (file: string, text: string | undefined): ReadonlySet<string> =>
  new Set(text === undefined ? [] : parseManifest(file, text).map((item) => item.name));

export const addedDependencies = (
  ctx: Pick<GateContext, "changes" | "git" | "base" | "runtime" | "paths">,
): readonly string[] =>
  ctx.changes
    .filter((change) => change.status !== "D" && MANIFEST.test(change.path))
    .flatMap((change) => {
      const before = namesIn(change.path, fileAt(ctx.git, ctx.base, change.oldPath ?? change.path));
      const now = ctx.runtime.readText(toAbsolutePath(change.path, ctx.paths.root));
      return [...namesIn(change.path, now.ok ? now.value : undefined)].filter((name) => !before.has(name));
    });
