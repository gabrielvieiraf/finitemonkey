import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [bin, tool, target, content] = process.argv.slice(2);
const cwd = process.cwd();
const input =
  tool === "Bash"
    ? { command: target }
    : { file_path: resolve(cwd, target), content: content ?? "", old_string: content ?? "", new_string: "" };
const event = { hook_event_name: "PreToolUse", session_id: "demo", cwd, tool_name: tool, tool_input: input };
const run = spawnSync("node", [bin, "hook", "PreToolUse"], { input: JSON.stringify(event), encoding: "utf8" });
const reply = run.stdout.trim() === "" ? {} : JSON.parse(run.stdout);
const specific = reply.hookSpecificOutput ?? {};
const red = (text) => `\u001b[1;31m${text}\u001b[0m`;
const green = (text) => `\u001b[1;32m${text}\u001b[0m`;

if (specific.permissionDecision === "deny") {
  console.log(red("  ✗ PreToolUse: denied"));
  for (const line of String(specific.permissionDecisionReason).split("\n")) console.log(`    ${line}`);
} else {
  console.log(green("  ✓ PreToolUse: allowed"));
  if (specific.additionalContext) console.log(`    ${specific.additionalContext}`);
}
