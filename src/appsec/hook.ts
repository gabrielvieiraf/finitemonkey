import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { FILE_TOOLS, guardRoot } from "../guards/context.js";
import { applyEdits, editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler } from "../hooks/handlers.js";
import { scanContext } from "./config.js";
import { isAppsecSource, scanText } from "./scan.js";
import { OWASP } from "./types.js";

const ALLOW: HookDecision = { kind: "allow" };

export const appsecEditWarning: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  if (!FILE_TOOLS.has(tool)) return ALLOW;
  const args = toolInput(input.payload.raw);
  const target = textField(args, "file_path") ?? "";
  const root = guardRoot(input);
  const absolute = toAbsolutePath(target, root);
  const file = toPosixPath(relative(root, absolute));
  if (target === "" || !isAppsecSource(file)) return ALLOW;
  const read = input.runtime.readText(absolute);
  const before = read.ok ? read.value : "";
  const content = textField(args, "content");
  const after = tool === "Write" && content !== undefined ? content : applyEdits(before, editsOf(args));
  const ctx = scanContext(input.runtime, root);
  const known = new Set(scanText(file, before, ctx).map((finding) => finding.fingerprint));
  const fresh = scanText(file, after, ctx).filter((finding) => !known.has(finding.fingerprint));
  if (fresh.length === 0) return ALLOW;
  const lines = fresh.map(
    (finding) =>
      `- ${input.t(`appsec.rule.${finding.rule}`, { file, line: finding.line, detail: finding.detail })} (${OWASP[finding.owasp]})`,
  );
  const additionalContext = `finitemonkey: ${input.t("appsec.warn.header")}\n${lines.join("\n")}`;
  return { kind: "allow", output: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } } };
};
