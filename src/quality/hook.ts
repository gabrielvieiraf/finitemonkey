import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { contextOutput } from "../gate/hooks/common.js";
import { deny, guardRoot } from "../guards/context.js";
import { applyEdits, editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { isQualityFile, loadLimits } from "./limits.js";
import { lineCount } from "./metrics.js";
import { fileSizeFinding } from "./ratchet.js";

const ALLOW: HookDecision = { kind: "allow" };
const WRITERS = new Set(["Write", "Edit", "MultiEdit"]);

export const qualitySizeGuard: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  if (!WRITERS.has(tool)) return ALLOW;
  const args = toolInput(input.payload.raw);
  const target = textField(args, "file_path") ?? "";
  if (target === "") return ALLOW;
  const root = guardRoot(input);
  const absolute = toAbsolutePath(target, root);
  const file = toPosixPath(relative(root, absolute));
  const limits = loadLimits(input.runtime, root);
  if (file.startsWith("..") || !isQualityFile(file, limits)) return ALLOW;
  const read = input.runtime.readText(absolute);
  const before = read.ok ? read.value : undefined;
  const content = textField(args, "content");
  const after = tool === "Write" && content !== undefined ? content : applyEdits(before ?? "", editsOf(args));
  const finding = fileSizeFinding(file, before === undefined ? undefined : lineCount(before), lineCount(after), limits);
  if (finding === undefined) return ALLOW;
  const params = { file, lines: finding.params["lines"] ?? 0, max: finding.params["max"] ?? 0 };
  const { t } = input;
  if (finding.level === "warn") {
    return { kind: "allow", output: contextOutput("PreToolUse", `finitemonkey: ${t("quality.warn.size", params)}`) };
  }
  const reason = modelReason(t, "quality.block.size", params);
  return {
    ...deny(reason, t("quality.block.human", params)),
    warning: `finitemonkey: ${t("quality.warn.size", params)}`,
  };
};

export const QUALITY_HANDLERS: HookHandlers = { PreToolUse: [qualitySizeGuard] };
