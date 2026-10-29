import { projectPaths } from "../gate/hooks/common.js";
import { editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { untrustedRecorder } from "../learnings/hooks.js";
import { untrustedIn } from "../policy/untrusted.js";
import { instructionLines } from "./quarantine.js";

const WRITERS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);
const MEMORY_DIR = /[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]memory[\\/][^\\/]+$/;
const allow = { kind: "allow" } as const;

export const isNativeMemory = (file: string): boolean => MEMORY_DIR.test(file);

const writtenText = (raw: Parameters<typeof toolInput>[0]): string => {
  const input = toolInput(raw);
  return (
    textField(input, "content") ??
    editsOf(input)
      .map((edit) => edit.newText)
      .join("\n")
  );
};

export const memoryWriteGuard: HookHandler = (input) => {
  const raw = input.payload.raw;
  const file = textField(toolInput(raw), "file_path") ?? "";
  if (!WRITERS.has(toolName(raw)) || !isNativeMemory(file)) return allow;
  const paths = projectPaths(input);
  const source = paths === undefined ? undefined : untrustedIn(input.runtime, paths, input.payload.sessionId ?? "");
  if (source === undefined) return allow;
  const line = instructionLines(writtenText(raw))[0];
  if (line === undefined) return allow;
  const reason = input.t("knowledge.memory.blocked", { source, line: line.slice(0, 160) });
  return { kind: "block", reason, human: reason };
};

export const MEMORY_QUARANTINE_HANDLERS: HookHandlers = {
  PreToolUse: [memoryWriteGuard],
  PostToolUse: [untrustedRecorder],
};
