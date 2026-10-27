import { isRecord, type JsonObject } from "../core/parsed.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import { stringifyYaml } from "../core/yaml/write.js";

export interface FrontMatter {
  readonly data: JsonObject | undefined;
  readonly body: string;
}

const FENCE = "---";

export const readFront = (text: string): FrontMatter => {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FENCE}\n`)) return { data: undefined, body: normalized };
  const end = normalized.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (end === -1) return { data: undefined, body: normalized };
  const parsed = parseYaml(normalized.slice(FENCE.length + 1, end + 1));
  const data = parsed.ok && isRecord(parsed.value) ? parsed.value : undefined;
  return { data, body: normalized.slice(end + FENCE.length + 2).replace(/^\n/, "") };
};

export const writeFront = (data: YamlValue, body: string): string =>
  `${FENCE}\n${stringifyYaml(data)}${FENCE}\n\n${body}`;

export const textList = (record: JsonObject, key: string): readonly string[] => {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};
