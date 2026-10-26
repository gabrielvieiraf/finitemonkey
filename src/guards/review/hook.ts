import { textField } from "../../hooks/fields.js";
import type { HookHandler } from "../../hooks/handlers.js";
import { FORBIDDEN_TOOLS, reviewAgentOf } from "../../review/agents.js";

const FORBIDDEN: ReadonlySet<string> = new Set(FORBIDDEN_TOOLS);

export const reviewAgentGuard: HookHandler = (input) => {
  const agent = reviewAgentOf(textField(input.payload.raw, "agent_type") ?? "");
  const tool = textField(input.payload.raw, "tool_name") ?? "";
  if (agent === undefined || !FORBIDDEN.has(tool)) return { kind: "allow" };
  return { kind: "block", reason: input.t("review.guard.read_only", { agent, tool }) };
};
