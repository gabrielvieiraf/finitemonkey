import { logEvent } from "../../evidence/log.js";
import { textField, toolName } from "../../hooks/fields.js";
import type { HookHandler } from "../../hooks/handlers.js";
import { projectPaths } from "./common.js";

export const permissionDenied: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return { kind: "allow" };
  const raw = input.payload.raw;
  logEvent(input.runtime, paths, "permission.denied", {
    tool: toolName(raw),
    rule: textField(raw, "rule", "permission_rule", "matched_rule", "decision_reason", "reason") ?? null,
    reason: textField(raw, "reason", "message") ?? null,
    sessionId: input.payload.sessionId ?? null,
  });
  return { kind: "allow" };
};
