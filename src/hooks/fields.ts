import { isRecord, type JsonObject } from "../core/parsed.js";

export const textField = (record: JsonObject, ...names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string") return value;
  }
  return undefined;
};

export const toolName = (raw: JsonObject): string => textField(raw, "tool_name") ?? "";

export const toolInput = (raw: JsonObject): JsonObject => {
  const value = raw["tool_input"];
  return isRecord(value) ? value : {};
};

export const editsOf = (
  input: JsonObject,
): readonly { readonly oldText: string; readonly newText: string; readonly all: boolean }[] => {
  const single = textField(input, "old_string");
  const replacement = textField(input, "new_string");
  if (single !== undefined && replacement !== undefined) {
    return [{ oldText: single, newText: replacement, all: input["replace_all"] === true }];
  }
  const edits = input["edits"];
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit: unknown) => {
    if (!isRecord(edit)) return [];
    const oldText = textField(edit, "old_string");
    const newText = textField(edit, "new_string");
    return oldText === undefined || newText === undefined
      ? []
      : [{ oldText, newText, all: edit["replace_all"] === true }];
  });
};

export const applyEdits = (before: string, edits: ReturnType<typeof editsOf>): string =>
  edits.reduce(
    (text, edit) =>
      edit.all ? text.split(edit.oldText).join(edit.newText) : text.replace(edit.oldText, () => edit.newText),
    before,
  );
