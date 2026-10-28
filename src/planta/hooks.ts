import { findRepoRoot, sessionCwd } from "../gate/hooks/common.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { fmPaths } from "../task/paths.js";
import { evaluateBlueprint } from "./evaluate.js";
import { labelGuard } from "./label-guard.js";
import { activeBlueprint, approvedItems, readCachedBar, writeCachedBar } from "./store.js";
import { projectView } from "./view.js";

export const refreshBar: HookHandler = (input) => {
  const root = findRepoRoot(input.runtime, sessionCwd(input));
  if (root === undefined) return { kind: "allow" };
  const paths = fmPaths(root);
  const type = activeBlueprint(input.runtime, paths) ?? readCachedBar(input.runtime, paths)?.type;
  if (type === undefined) return { kind: "allow" };
  writeCachedBar(
    input.runtime,
    paths,
    evaluateBlueprint(type, projectView(input.runtime, root), approvedItems(input.runtime, paths)),
  );
  return { kind: "allow" };
};

export const PLANTA_HANDLERS: HookHandlers = { Stop: [refreshBar] };

export const LABEL_HANDLERS: HookHandlers = { Stop: [labelGuard] };
