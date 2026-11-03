import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { adoptable } from "./adopt.js";
import { gitWorktrees } from "./git-list.js";
import { commonDirOf, readRegistry } from "./store.js";

export const unregisteredWorktrees = (runtime: Runtime, root: AbsolutePath): readonly string[] => {
  const common = commonDirOf(runtime, root);
  const trees = gitWorktrees(runtime, root) ?? [];
  const registry = common === undefined ? undefined : readRegistry(runtime, common);
  return registry?.ok === true ? adoptable(registry.value, trees).map((tree) => tree.path) : [];
};
