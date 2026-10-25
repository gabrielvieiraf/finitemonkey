import { relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, optionalString } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { toolInput, toolName } from "../secrets/guards/tool-input.js";
import { ALLOW_MARKER, markerCount } from "./marker.js";
import { shellWords } from "./shell-words.js";

const ALLOW: HookDecision = { kind: "allow" };
const SHELLS = new Set(["Bash", "PowerShell"]);
const READ_ONLY = new Set(["grep", "rg", "cat", "less", "head", "tail", "ls", "wc", "finitemonkey", "fm"]);
const GIT_READ_ONLY = new Set(["grep", "log", "show", "diff", "status", "blame"]);

const counted = (input: JsonObject, key: string): number => markerCount(optionalString(input, key) ?? "");

const existingCount = (input: HookInput, file: string): number => {
  if (file === "") return 0;
  const read = input.runtime.readText(toAbsolutePath(file, input.cwd));
  return read.ok ? markerCount(read.value) : 0;
};

const editPairs = (input: JsonObject): readonly (readonly [number, number])[] => {
  const edits = input["edits"];
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit) => (isRecord(edit) ? [[counted(edit, "old_string"), counted(edit, "new_string")]] : []));
};

const addsMarker = (input: HookInput, tool: string, inputs: JsonObject, file: string): boolean => {
  switch (tool) {
    case "Write":
      return counted(inputs, "content") > existingCount(input, file);
    case "Edit":
      return counted(inputs, "new_string") > counted(inputs, "old_string");
    case "MultiEdit":
      return editPairs(inputs).reduce((sum, [before, after]) => sum + after - before, 0) > 0;
    case "NotebookEdit":
      return counted(inputs, "new_source") > 0;
    default:
      return false;
  }
};

const isReadOnly = (program: string, args: readonly string[]): boolean =>
  READ_ONLY.has(program) || (program === "git" && GIT_READ_ONLY.has(args[0] ?? ""));

const shellAddsMarker = (command: string): boolean =>
  command.includes(ALLOW_MARKER) &&
  shellWords(command).segments.some((segment) => !isReadOnly(segment.program, segment.args));

const shown = (cwd: AbsolutePath, file: string): string => {
  const rel = toPosixPath(relative(cwd, file));
  return file === "" || rel.startsWith("..") ? toPosixPath(file) : rel;
};

const blocked = (input: HookInput, file: string): HookDecision => ({
  kind: "block",
  reason: input.t("prose.block.marker", { marker: ALLOW_MARKER, file }),
});

export const proseMarkerGuard: HookHandler = (input) => {
  const tool = toolName(input.payload);
  const inputs = toolInput(input.payload);
  if (SHELLS.has(tool)) {
    if (!shellAddsMarker(optionalString(inputs, "command") ?? "")) return ALLOW;
    return { kind: "block", reason: input.t("prose.block.marker_shell", { marker: ALLOW_MARKER }) };
  }
  const file = optionalString(inputs, "file_path") ?? optionalString(inputs, "notebook_path") ?? "";
  return addsMarker(input, tool, inputs, file) ? blocked(input, shown(input.cwd, file)) : ALLOW;
};
