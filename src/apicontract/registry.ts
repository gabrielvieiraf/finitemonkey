import { accept, isRecord, type JsonObject, type Parsed, reject } from "../core/parsed.js";
import { parseYaml } from "../core/yaml/parse.js";

export const CONTRACT_FILE = "api/contract.yml";
export const CONTRACT_FEATURE = "contract";
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const FIELD_TYPES = ["string", "number", "boolean", "string[]", "number[]"] as const;

export type Method = (typeof METHODS)[number];
export type FieldType = (typeof FIELD_TYPES)[number];

export interface Field {
  readonly name: string;
  readonly type: FieldType;
  readonly optional: boolean;
}

export interface Endpoint {
  readonly id: string;
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly domain: string;
  readonly list: boolean;
  readonly input: readonly Field[];
  readonly output: readonly Field[];
  readonly screens: readonly string[];
}

export interface ApiRegistry {
  readonly errors: readonly string[];
  readonly endpoints: readonly Endpoint[];
}

const ID = /^[a-z][A-Za-z0-9]*$/;
const CODE = /^[A-Z][A-Z0-9_]*$/;
const DOMAIN = /^[a-z][a-z0-9-]*$/;

type Issues = string[];

const fieldsOf = (value: unknown, at: string, issues: Issues): readonly Field[] => {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) {
    issues.push(`${at}: must be a mapping of field: type`);
    return [];
  }
  return Object.entries(value).flatMap(([name, raw]): Field[] => {
    const text = typeof raw === "string" ? raw : "";
    const optional = text.endsWith("?");
    const type = FIELD_TYPES.find((item) => item === text.replace(/\?$/, ""));
    if (type === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      issues.push(`${at}.${name}: use one of ${FIELD_TYPES.join(", ")} (add ? when optional)`);
      return [];
    }
    return [{ name, type, optional }];
  });
};

const text = (record: JsonObject, key: string, at: string, issues: Issues, pattern?: RegExp): string => {
  const value = record[key];
  if (typeof value === "string" && value.trim() !== "" && (pattern === undefined || pattern.test(value))) return value;
  issues.push(`${at}.${key}: required${pattern === undefined ? "" : ` and must match ${pattern.source}`}`);
  return "";
};

const endpointOf = (value: unknown, index: number, issues: Issues): Endpoint | undefined => {
  const at = `endpoints[${String(index)}]`;
  if (!isRecord(value)) {
    issues.push(`${at}: must be a mapping`);
    return undefined;
  }
  const method = METHODS.find((item) => item === value["method"]);
  if (method === undefined) issues.push(`${at}.method: use ${METHODS.join(", ")}`);
  const screens = value["screens"];
  return {
    id: text(value, "id", at, issues, ID),
    method: method ?? "GET",
    path: text(value, "path", at, issues, /^\//),
    summary: text(value, "summary", at, issues),
    domain: text(value, "domain", at, issues, DOMAIN),
    list: value["list"] === true,
    input: fieldsOf(value["input"], `${at}.input`, issues),
    output: fieldsOf(value["output"], `${at}.output`, issues),
    screens: Array.isArray(screens) ? screens.filter((item): item is string => typeof item === "string") : [],
  };
};

export const parseRegistry = (source: string): Parsed<ApiRegistry, readonly string[]> => {
  const yaml = parseYaml(source);
  if (!yaml.ok) return reject([`line ${String(yaml.error.line)}: ${yaml.error.message}`]);
  if (!isRecord(yaml.value)) return reject(["contract.yml must be a mapping"]);
  const issues: Issues = [];
  const errors = Array.isArray(yaml.value["errors"])
    ? yaml.value["errors"].filter((item) => typeof item === "string")
    : [];
  if (errors.length === 0 || !errors.every((code) => CODE.test(code)))
    issues.push("errors: list the error codes in CAPS");
  const list = yaml.value["endpoints"];
  const endpoints = Array.isArray(list)
    ? list.flatMap((item: unknown, index) => endpointOf(item, index, issues) ?? [])
    : [];
  if (endpoints.length === 0) issues.push("endpoints: list at least one endpoint");
  return issues.length === 0 ? accept({ errors, endpoints }) : reject(issues);
};
