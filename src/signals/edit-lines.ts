import type { JsonObject } from "../core/parsed.js";
import { editsOf, textField } from "../hooks/fields.js";
import { hashText } from "./line-hashes.js";

const lineSpan = (text: string, start: number, length: number): string => {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const end = text.indexOf("\n", start + length);
  return text.slice(from, end < 0 ? text.length : end);
};

const spansOf = (after: string, needle: string, all: boolean): readonly string[] => {
  if (needle === "") return [];
  const spans: string[] = [];
  let at = after.indexOf(needle);
  while (at >= 0) {
    spans.push(lineSpan(after, at, needle.length));
    if (!all) break;
    at = after.indexOf(needle, at + needle.length);
  }
  return spans.length === 0 ? [needle] : spans;
};

export const writtenText = (input: JsonObject, after: string | undefined): string => {
  const content = textField(input, "content", "new_source");
  if (content !== undefined) return content;
  return editsOf(input)
    .flatMap((edit) => (after === undefined ? [edit.newText] : spansOf(after, edit.newText, edit.all)))
    .join("\n");
};

export const writtenLines = (input: JsonObject, after: string | undefined): { readonly lines?: readonly string[] } => {
  const lines = hashText(writtenText(input, after));
  return lines === undefined ? {} : { lines };
};
