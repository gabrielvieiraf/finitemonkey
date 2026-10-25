import { isRecord, type JsonObject, optionalString } from "../../core/parsed.js";
import type { HookPayload } from "../../hooks/payload.js";

export interface WrittenText {
  readonly file: string;
  readonly text: string;
  readonly whole: boolean;
}

export const toolName = (payload: HookPayload): string => optionalString(payload.raw, "tool_name") ?? "";

export const toolInput = (payload: HookPayload): JsonObject => {
  const input = payload.raw["tool_input"];
  return isRecord(input) ? input : {};
};

const editTexts = (input: JsonObject, file: string): readonly WrittenText[] => {
  const edits = input["edits"];
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit): WrittenText[] => {
    if (!isRecord(edit)) return [];
    const text = optionalString(edit, "new_string");
    return text === undefined ? [] : [{ file, text, whole: false }];
  });
};

export const writtenTexts = (tool: string, input: JsonObject): readonly WrittenText[] => {
  const file = optionalString(input, "file_path") ?? optionalString(input, "notebook_path") ?? "";
  const single = (key: string, whole: boolean): readonly WrittenText[] => {
    const text = optionalString(input, key);
    return text === undefined ? [] : [{ file, text, whole }];
  };
  switch (tool) {
    case "Write":
      return single("content", true);
    case "Edit":
      return single("new_string", false);
    case "MultiEdit":
      return editTexts(input, file);
    case "NotebookEdit":
      return single("new_source", false);
    default:
      return [];
  }
};

export const stringLeaves = (value: unknown, out: string[] = []): readonly string[] => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringLeaves(item, out);
  else if (isRecord(value)) for (const item of Object.values(value)) stringLeaves(item, out);
  return out;
};
