import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { deny, FILE_TOOLS, guardRoot, SHELL_TOOLS } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { proseInCommand, type TextSource } from "../prose/command-text.js";
import { dialectOf } from "../shell/normalize.js";
import { readManifest } from "./manifest.js";
import { commandMatches, pathMatches, textMatches } from "./match.js";
import { effectiveRules } from "./preset.js";
import type { ProjectRule } from "./types.js";

const ALLOW: HookDecision = { kind: "allow" };

const sourceText = (input: HookInput, source: TextSource): string => {
  if (source.kind === "inline") return source.text;
  const read = input.runtime.readText(toAbsolutePath(source.path, input.cwd));
  return read.ok ? read.value : "";
};

const textBroken = (input: HookInput, rule: ProjectRule, command: string): boolean =>
  proseInCommand(command).some((found) => {
    if (found.target === "issue") return false;
    const text = [found.title, ...found.bodies].flatMap((source) =>
      source === undefined ? [] : [sourceText(input, source)],
    );
    return textMatches(rule, found.target, text.join("\n\n"));
  });

const broken = (input: HookInput, rule: ProjectRule): boolean => {
  const tool = toolName(input.payload.raw);
  const args = toolInput(input.payload.raw);
  if (SHELL_TOOLS.has(tool)) {
    const command = textField(args, "command") ?? "";
    return commandMatches(rule, command, dialectOf(tool)) || textBroken(input, rule, command);
  }
  if (!FILE_TOOLS.has(tool)) return false;
  const root = guardRoot(input);
  const path = textField(args, "file_path", "notebook_path") ?? "";
  return path !== "" && pathMatches(rule, tool, toPosixPath(relative(root, toAbsolutePath(path, root))));
};

export const rulesGuard: HookHandler = (input) => {
  const root = guardRoot(input);
  const manifest = readManifest(input.runtime, root);
  if (Object.keys(manifest.rules).length === 0) return ALLOW;
  const rules = effectiveRules(input.runtime, root);
  if (!rules.ok) return ALLOW;
  const hit = rules.value.find(
    (rule) => manifest.rules[rule.id]?.surfaces.includes("guard") === true && broken(input, rule),
  );
  if (hit === undefined) return ALLOW;
  const params = { id: hit.id, text: hit.text };
  if (hit.severity === "prefer") {
    const additionalContext = `finitemonkey: ${input.t("rules.warn.prefer", params)}`;
    return { kind: "allow", output: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } } };
  }
  return deny(modelReason(input.t, "rules.block.broken", params), input.t("rules.block.human", params));
};
