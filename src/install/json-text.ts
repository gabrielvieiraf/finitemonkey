import { isRecord, type JsonObject, type Parsed, parseJsonObject } from "../core/parsed.js";

export interface JsonStyle {
  readonly indent: string;
  readonly finalNewline: boolean;
}

export const DEFAULT_STYLE: JsonStyle = { indent: "  ", finalNewline: true };

export const styleOf = (text: string): JsonStyle => {
  const indented = /\n([ \t]+)\S/.exec(text);
  return { indent: indented?.[1] ?? DEFAULT_STYLE.indent, finalNewline: text.endsWith("\n") };
};

export const renderJson = (value: JsonObject, style: JsonStyle): string =>
  `${JSON.stringify(value, null, style.indent)}${style.finalNewline ? "\n" : ""}`;

export const parseSettings = (text: string | undefined): Parsed<JsonObject> =>
  text === undefined || text.trim() === "" ? { ok: true, value: {} } : parseJsonObject(text);

export const asList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

export const asRecord = (value: unknown): JsonObject => (isRecord(value) ? value : {});

export const setKey = (record: JsonObject, key: string, value: unknown): JsonObject => {
  if (!(key in record)) return value === undefined ? record : { ...record, [key]: value };
  return Object.fromEntries(
    Object.entries(record).flatMap(([name, current]): [string, unknown][] => {
      if (name !== key) return [[name, current]];
      return value === undefined ? [] : [[name, value]];
    }),
  );
};
