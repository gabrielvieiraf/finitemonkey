import { projectPaths } from "../gate/hooks/common.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { readState } from "../task/state.js";
import { PROVIDER_ENV } from "./kinds.js";
import { isEnabled } from "./store.js";

export const providerStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.payload.stopHookActive || input.env[PROVIDER_ENV] !== undefined)
    return { kind: "allow" };
  if (!isEnabled(input.runtime, paths, "blind-writer")) return { kind: "allow" };
  const task = readState(input.runtime, paths).active;
  if (task !== undefined) input.runtime.spawnSelf(["provider", "run", "blind-writer", "--task", task], paths.root);
  return { kind: "allow" };
};

export const PROVIDER_HANDLERS: HookHandlers = { Stop: [providerStop] };
