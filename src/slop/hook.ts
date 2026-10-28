import { join, relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { guardRoot } from "../guards/context.js";
import { applyEdits, editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { addedByContent, analyzeSlop } from "./analyze.js";
import { loadSlopConfig } from "./config.js";
import { isDismissed, readSlopStore } from "./store.js";

const ALLOW: HookDecision = { kind: "allow" };
const WRITERS = new Set(["Write", "Edit", "MultiEdit"]);
const MAX_LINES = 8;

export const slopEditWarning: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  if (!WRITERS.has(tool)) return ALLOW;
  const args = toolInput(input.payload.raw);
  const target = textField(args, "file_path") ?? "";
  if (target === "") return ALLOW;
  const root = guardRoot(input);
  const absolute = toAbsolutePath(target, root);
  const file = toPosixPath(relative(root, absolute));
  if (file.startsWith("..")) return ALLOW;
  const read = input.runtime.readText(absolute);
  const before = read.ok ? read.value : undefined;
  const content = textField(args, "content");
  const after = tool === "Write" && content !== undefined ? content : applyEdits(before ?? "", editsOf(args));
  const paths = projectPaths(input);
  const store = paths === undefined ? undefined : readSlopStore(input.runtime, paths);
  const found = analyzeSlop({
    files: [{ file, text: after, added: addedByContent(before, after), created: before === undefined }],
    exists: (other) => input.runtime.stat(toAbsolutePath(join(root, other)))?.kind === "file",
    config: loadSlopConfig(input.runtime, root),
    ts: undefined,
  }).filter((item) => store === undefined || !isDismissed(store, item));
  if (found.length === 0) return ALLOW;
  const lines = found
    .slice(0, MAX_LINES)
    .map(
      (item) => `- ${input.t(`gate.slop.${item.detector}`, { file: item.file, line: item.line, detail: item.detail })}`,
    );
  return {
    kind: "allow",
    output: contextOutput("PreToolUse", `finitemonkey: ${input.t("slop.warn.header")}\n${lines.join("\n")}`),
  };
};

export const SLOP_HANDLERS: HookHandlers = { PreToolUse: [slopEditWarning] };
