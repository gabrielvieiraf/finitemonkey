import type { YamlValue } from "./scalar.js";

const PLAIN_SAFE = /^[A-Za-z_./][A-Za-z0-9_./ ()-]*$/;
const RESERVED = /^(true|false|null|~|-?\d.*)$/;

const scalarText = (value: string | number | boolean | null): string => {
  if (value === null) return "null";
  if (typeof value !== "string") return String(value);
  return PLAIN_SAFE.test(value) && !RESERVED.test(value) && !value.endsWith(" ") ? value : JSON.stringify(value);
};

const isScalar = (value: YamlValue): value is string | number | boolean | null =>
  value === null || typeof value !== "object";

const inline = (value: YamlValue): string | undefined => {
  if (isScalar(value)) return scalarText(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.every(isScalar) ? `[${value.map(scalarText).join(", ")}]` : undefined;
  }
  return Object.keys(value).length === 0 ? "{}" : undefined;
};

const lines = (value: YamlValue, indent: string): readonly string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item: YamlValue) => {
      const flat = inline(item);
      if (flat !== undefined) return [`${indent}- ${flat}`];
      const [head = "", ...rest] = lines(item, `${indent}  `);
      return [`${indent}- ${head.trimStart()}`, ...rest];
    });
  }
  if (isScalar(value)) return [`${indent}${scalarText(value)}`];
  return Object.entries(value).flatMap(([key, item]) => {
    const flat = inline(item);
    const name = scalarText(key);
    return flat === undefined ? [`${indent}${name}:`, ...lines(item, `${indent}  `)] : [`${indent}${name}: ${flat}`];
  });
};

export const stringifyYaml = (value: YamlValue): string => `${lines(value, "").join("\n")}\n`;
