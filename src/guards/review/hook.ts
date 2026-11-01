import { projectPaths } from "../../gate/hooks/common.js";
import { textField, toolInput } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { FORBIDDEN_TOOLS, reviewAgentOf } from "../../review/agents.js";
import { readOnlyViolation } from "../../review/read-only-shell.js";
import { dialectOf } from "../../shell/normalize.js";

const FORBIDDEN: ReadonlySet<string> = new Set(FORBIDDEN_TOOLS);
const SHELLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);

const shellViolation = (input: HookInput, agent: string): HookDecision => {
  const tool = textField(input.payload.raw, "tool_name") ?? "";
  const command = textField(toolInput(input.payload.raw), "command") ?? "";
  const repoRoot = projectPaths(input)?.root;
  const detail = readOnlyViolation(command, dialectOf(tool), { cwd: input.cwd, repoRoot });
  return detail === undefined
    ? { kind: "allow" }
    : { kind: "block", reason: input.t("review.guard.shell_write", { agent, tool, detail }) };
};

export const reviewAgentGuard: HookHandler = (input) => {
  const agent = reviewAgentOf(textField(input.payload.raw, "agent_type") ?? "");
  const tool = textField(input.payload.raw, "tool_name") ?? "";
  if (agent === undefined) return { kind: "allow" };
  if (SHELLS.has(tool)) return shellViolation(input, agent);
  if (!FORBIDDEN.has(tool)) return { kind: "allow" };
  return { kind: "block", reason: input.t("review.guard.read_only", { agent, tool }) };
};
