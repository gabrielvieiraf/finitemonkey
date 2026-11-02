import type { Runtime } from "../core/runtime.js";
import { loadPolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { TEACH_FEATURE } from "./types.js";

export const teachOptedIn = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): boolean => {
  const policy = loadPolicy(runtime, paths.root);
  return (policy.guards[TEACH_FEATURE] ?? policy.userGuards[TEACH_FEATURE]) === "active";
};
