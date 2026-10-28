export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const WIDTH = 80;
const PAD = "  ";

const isObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isList = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

const inline = (value: JsonValue): string | undefined => {
  if (isObject(value)) return Object.keys(value).length === 0 ? "{}" : undefined;
  if (!isList(value)) return JSON.stringify(value);
  const parts = value.map(inline);
  return parts.every((part): part is string => part !== undefined) ? `[${parts.join(", ")}]` : undefined;
};

const print = (value: JsonValue, depth: number, used: number): string => {
  if (!isObject(value) && !isList(value)) return JSON.stringify(value);
  const flat = inline(value);
  if (flat !== undefined && used + flat.length <= WIDTH && !(isObject(value) && Object.keys(value).length > 0)) {
    return flat;
  }
  const inner = PAD.repeat(depth + 1);
  const close = PAD.repeat(depth);
  if (isObject(value)) {
    const rows = Object.entries(value).map(([key, item]) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      return `${head}${print(item, depth + 1, head.length + 1)}`;
    });
    return `{\n${rows.join(",\n")}\n${close}}`;
  }
  const items = isList(value) ? value : [];
  return `[\n${items.map((item) => `${inner}${print(item, depth + 1, inner.length + 1)}`).join(",\n")}\n${close}]`;
};

export const printJson = (value: JsonValue): string => `${print(value, 0, 0)}\n`;
