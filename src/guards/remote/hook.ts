import { isAbsolute, join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { optionalString } from "../../core/parsed.js";
import { logEvent } from "../../evidence/log.js";
import { projectPaths } from "../../gate/hooks/common.js";
import { loadProjectConfig } from "../../git/project-config.js";
import { toolInput, toolName } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { maskText } from "../../mask/mask.js";
import { featureMode } from "../../policy/feature.js";
import { callOf } from "./catalog.js";
import { type Classification, classifyWithScripts, isCandidate, NO_EXTENSION, remoteExtension } from "./classify.js";
import type { ScriptReader } from "./script-file.js";

export const REMOTE_FEATURE = "remote-destructive";

const ALLOW: HookDecision = { kind: "allow" };

type Decision = "held" | "shadow" | "ran";

const SCRIPT_LIMIT_BYTES = 512 * 1024;

const scriptReader =
  (input: HookInput): ScriptReader =>
  (file) => {
    const path = toAbsolutePath(isAbsolute(file) ? file : join(input.cwd, file));
    const stat = input.runtime.stat(path);
    if (stat?.kind !== "file" || (stat.size ?? 0) > SCRIPT_LIMIT_BYTES) return undefined;
    const text = input.runtime.readText(path);
    return text.ok ? text.value : undefined;
  };

const classified = (input: HookInput): Classification | undefined => {
  const tool = toolName(input.payload.raw);
  if (!isCandidate(tool)) return undefined;
  const paths = projectPaths(input);
  const extension = paths === undefined ? NO_EXTENSION : remoteExtension(loadProjectConfig(input.runtime, paths.root));
  const result = classifyWithScripts(callOf(tool, toolInput(input.payload.raw)), extension, scriptReader(input));
  return result.effect === "destroy" || result.effect === "write" ? result : undefined;
};

const heldMode = (input: HookInput, found: Classification): "held" | "shadow" | "off" => {
  if (found.effect === "destroy" && !found.heuristic) return "held";
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
    effect: found.effect,
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
  const write = found.effect === "write";
  const reason = write ? input.t("remote.write.reason", params) : input.t("remote.hold.reason", params);
  const human = write ? input.t("remote.write.human", params) : input.t("remote.hold.human", params);
  return {
    kind: "allow",
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
      systemMessage: `finitemonkey: ${human}`,
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
