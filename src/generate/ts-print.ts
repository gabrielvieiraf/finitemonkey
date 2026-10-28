import type { JsonValue } from "./json-print.js";

const WIDTH = 80;
const PAD = "  ";
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const isList = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

const isObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  typeof value === "object" && value !== null && !isList(value);

const key = (name: string): string => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

const inline = (value: JsonValue): string | undefined => {
  if (isObject(value)) return Object.keys(value).length === 0 ? "{}" : undefined;
  if (!isList(value)) return JSON.stringify(value);
  const parts = value.map(inline);
  return parts.every((part): part is string => part !== undefined) ? `[${parts.join(", ")}]` : undefined;
};

export const printTsValue = (value: JsonValue, depth: number, used: number, tail = 1): string => {
  const flat = inline(value);
  if (flat !== undefined && (!isList(value) || used + flat.length + tail <= WIDTH)) return flat;
  const inner = PAD.repeat(depth + 1);
  const close = PAD.repeat(depth);
  if (isObject(value)) {
    const rows = Object.entries(value).map(([name, item]) => {
      const head = `${inner}${key(name)}: `;
      return `${head}${printTsValue(item, depth + 1, head.length)},`;
    });
    return `{\n${rows.join("\n")}\n${close}}`;
  }
  const items = isList(value) ? value : [];
  return `[\n${items.map((item) => `${inner}${printTsValue(item, depth + 1, inner.length)},`).join("\n")}\n${close}]`;
};
