import { nowMs } from "../core/clock.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import { editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { baseOf, projectFile, record, scopeOf, type SignalScope } from "./context.js";
import { errorSignature, shortHash } from "./signature.js";
import type { SignalEntry } from "./store.js";
import { writeIndex } from "./write-index.js";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
export const FAST_ACCEPT_MS = 5000;
export const LARGE_DIFF_LINES = 30;

const allow = { kind: "allow" } as const;

const permissionKey = (raw: JsonObject): string => {
  const id = textField(raw, "tool_use_id");
  if (id !== undefined && id !== "") return id;
  const input = toolInput(raw);
  return `${toolName(raw)}:${textField(input, "file_path", "notebook_path", "command") ?? ""}`;
};

const lineCount = (text: string): number => (text === "" ? 0 : text.split("\n").length);

const changedLines = (input: JsonObject): number => {
  const content = textField(input, "content", "new_source");
  if (content !== undefined) return lineCount(content);
  return editsOf(input).reduce((sum, edit) => sum + Math.max(lineCount(edit.oldText), lineCount(edit.newText)), 0);
};

const editHashes = (file: string, input: JsonObject): { readonly forward: string; readonly backward: string } => {
  const content = textField(input, "content", "new_source");
  if (content !== undefined) return { forward: shortHash(`${file}\0${content}`), backward: "" };
  const edits = editsOf(input);
  const forward = edits.map((edit) => `${edit.oldText}\0${edit.newText}`).join("\u0001");
  const backward = [...edits]
    .reverse()
    .map((edit) => `${edit.newText}\0${edit.oldText}`)
    .join("\u0001");
  return { forward: shortHash(`${file}\0${forward}`), backward: shortHash(`${file}\0${backward}`) };
};

const isUndo = (scope: SignalScope, file: string, hashes: ReturnType<typeof editHashes>): boolean => {
  const earlier = scope.entries.filter(
    (entry): entry is Extract<SignalEntry, { kind: "edit" }> =>
      entry.kind === "edit" && entry.session === scope.session && entry.file === file,
  );
  if (hashes.backward !== "") return earlier.some((entry) => entry.hash === hashes.backward);
  const last = earlier.at(-1);
  return last !== undefined && last.hash !== hashes.forward && earlier.some((entry) => entry.hash === hashes.forward);
};

const approvalOf = (scope: SignalScope, raw: JsonObject, file: string, lines: number): SignalEntry | undefined => {
  const key = permissionKey(raw);
  const asked = scope.entries.findLast(
    (entry) => entry.kind === "permission" && entry.session === scope.session && entry.key === key,
  );
  if (asked === undefined) return undefined;
  const ms = Math.max(0, nowMs(scope.input.runtime) - Date.parse(asked.at));
  const fast = lines >= LARGE_DIFF_LINES && ms <= FAST_ACCEPT_MS;
  return { ...baseOf(scope), kind: "approved", file, lines, ms, fast };
};

const recordEdit = (scope: SignalScope, raw: JsonObject): SignalScope => {
  const input = toolInput(raw);
  const target = textField(input, "file_path", "notebook_path");
  if (target === undefined) return scope;
  const file = projectFile(scope, target);
  const hashes = editHashes(file, input);
  const edited = record(scope, {
    ...baseOf(scope),
    kind: "edit",
    file,
    hash: hashes.forward,
    undo: isUndo(scope, file, hashes),
  });
  const approved = approvalOf(edited, raw, file, changedLines(input));
  return approved === undefined ? edited : record(edited, approved);
};

const failedOutput = (raw: JsonObject): string | undefined => {
  const response = raw["tool_response"];
  if (!isRecord(response)) return undefined;
  const code = response["exitCode"] ?? response["exit_code"];
  const failed = (typeof code === "number" && code !== 0) || response["is_error"] === true;
  if (!failed) return undefined;
  return [textField(response, "stdout") ?? "", textField(response, "stderr") ?? ""].join("\n");
};

const recordError = (scope: SignalScope, raw: JsonObject, output: string): SignalScope => {
  const signature = errorSignature(output);
  if (signature === undefined) return scope;
  return record(scope, { ...baseOf(scope), kind: "error", tool: toolName(raw), ...signature });
};

export const signalsPostToolUse: HookHandler = (input) => {
  const scope = scopeOf(input);
  if (scope === undefined) return allow;
  const raw = input.payload.raw;
  const output = failedOutput(raw);
  const after = EDIT_TOOLS.has(toolName(raw))
    ? recordEdit(scope, raw)
    : output === undefined
      ? scope
      : recordError(scope, raw, output);
  if (after !== scope) writeIndex(after);
  return allow;
};

export const signalsPostToolUseFailure: HookHandler = (input) => {
  const scope = scopeOf(input);
  const raw = input.payload.raw;
  if (scope === undefined || raw["is_interrupt"] === true) return allow;
  const after = recordError(scope, raw, textField(raw, "error") ?? "");
  if (after !== scope) writeIndex(after);
  return allow;
};

export const signalsPermissionRequest: HookHandler = (input) => {
  const scope = scopeOf(input);
  if (scope !== undefined)
    record(scope, { ...baseOf(scope), kind: "permission", key: permissionKey(input.payload.raw) });
  return allow;
};
