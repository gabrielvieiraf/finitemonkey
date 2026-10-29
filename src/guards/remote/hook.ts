import { optionalString } from "../../core/parsed.js";
import { logEvent } from "../../evidence/log.js";
import { projectPaths } from "../../gate/hooks/common.js";
import { loadProjectConfig } from "../../git/project-config.js";
import { toolInput, toolName } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { maskText } from "../../mask/mask.js";
import { featureMode } from "../../policy/feature.js";
import { callOf } from "./catalog.js";
import { type Classification, classifyCall, isCandidate, NO_EXTENSION, remoteExtension } from "./classify.js";

export const REMOTE_FEATURE = "remote-destructive";

const ALLOW: HookDecision = { kind: "allow" };

type Decision = "held" | "shadow" | "ran";

const classified = (input: HookInput): Classification | undefined => {
  const tool = toolName(input.payload.raw);
  if (!isCandidate(tool)) return undefined;
  const paths = projectPaths(input);
  const extension = paths === undefined ? NO_EXTENSION : remoteExtension(loadProjectConfig(input.runtime, paths.root));
  const result = classifyCall(callOf(tool, toolInput(input.payload.raw)), extension);
  return result.effect === "destroy" ? result : undefined;
};

const heldMode = (input: HookInput, found: Classification): "held" | "shadow" | "off" => {
  if (!found.heuristic) return "held";
  const paths = projectPaths(input);
  const mode = paths === undefined ? "shadow" : featureMode(input.runtime, paths, REMOTE_FEATURE);
  return mode === "active" ? "held" : mode;
};

const record = (input: HookInput, found: Classification, decision: Decision | "approved"): void => {
  const paths = projectPaths(input);
  if (paths === undefined) return;
  logEvent(input.runtime, paths, "remote_hold", {
    tool: toolName(input.payload.raw),
    entry: found.entry,
    target: maskText(found.target),
    heuristic: found.heuristic,
    decision,
    toolUseId: optionalString(input.payload.raw, "tool_use_id") ?? null,
    sessionId: input.payload.sessionId ?? null,
  });
};

export const remotePreToolUse: HookHandler = (input) => {
  const found = classified(input);
  if (found === undefined) return ALLOW;
  const mode = heldMode(input, found);
  if (mode === "off") return ALLOW;
  record(input, found, mode);
  if (mode === "shadow") return ALLOW;
  const params = { target: maskText(found.target), entry: found.entry };
  return {
    kind: "allow",
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: input.t("remote.hold.reason", params),
      },
      systemMessage: `finitemonkey: ${input.t("remote.hold.human", params)}`,
    },
  };
};

export const remotePostToolUse: HookHandler = (input) => {
  const found = classified(input);
  if (found === undefined) return ALLOW;
  const mode = heldMode(input, found);
  if (mode !== "off") record(input, found, mode === "held" ? "approved" : "ran");
  return ALLOW;
};
