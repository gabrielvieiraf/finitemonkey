import { projectPaths } from "../gate/hooks/common.js";
import { toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "./feature.js";
import { changedSince } from "./mcp-pins.js";

export const MCP_PIN_FEATURE = "mcp-pin";

const ALLOW: HookDecision = { kind: "allow" };

export const mcpPinGuard: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  const paths = projectPaths(input);
  if (!tool.startsWith("mcp__") || paths === undefined) return ALLOW;
  const pin = changedSince(input.runtime, paths, tool);
  if (pin?.changed === undefined) return ALLOW;
  const mode = featureMode(input.runtime, paths, MCP_PIN_FEATURE);
  if (mode === "shadow")
    recordFeatureShadow(input.runtime, paths, MCP_PIN_FEATURE, { tool, pinned: pin.hash, seen: pin.changed.hash });
  if (mode !== "active") return ALLOW;
  return {
    kind: "allow",
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: input.t("mcp.pin.ask", { tool }),
      },
    },
  };
};

export const MCP_PIN_HANDLERS: HookHandlers = { PreToolUse: [mcpPinGuard] };
