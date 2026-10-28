import type { JsonObject } from "../core/parsed.js";
import { logEvent } from "../evidence/log.js";
import { contextOutput } from "../gate/hooks/common.js";
import type { HookDecision, HookInput } from "../hooks/handlers.js";
import type { FmPaths } from "../task/paths.js";
import { modeOf, readShadow } from "./guards.js";
import { loadPolicy } from "./policy.js";

export const injectContext = (
  input: HookInput,
  paths: FmPaths,
  guard: { readonly id: string; readonly event: string },
  text: string,
  data: JsonObject,
): HookDecision => {
  const mode = modeOf(
    { id: guard.id, damage: false },
    loadPolicy(input.runtime, paths.root),
    readShadow(input.runtime, paths),
  );
  const active = mode === "active";
  logEvent(input.runtime, paths, `${guard.event}_${active ? "injected" : "shadow"}`, {
    hook: input.event,
    sessionId: input.payload.sessionId ?? null,
    ...data,
  });
  return active ? { kind: "allow", output: contextOutput(input.event, text) } : { kind: "allow" };
};
