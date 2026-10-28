import { printTsValue } from "../generate/ts-print.js";
import type { ApiRegistry, Endpoint, Field } from "./registry.js";
import { closeImport, imported } from "./syntax.js";

const STATUS: Readonly<Record<string, number>> = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INTERNAL: 500,
  SERVER_ERROR: 500,
};

const tsType = (field: Field): string => (field.type.endsWith("[]") ? `${field.type.slice(0, -2)}[]` : field.type);

const shape = (fields: readonly Field[], indent: string): string =>
  fields.length === 0
    ? "Record<string, never>"
    : `{\n${fields.map((field) => `${indent}  ${field.name}${field.optional ? "?" : ""}: ${tsType(field)};`).join("\n")}\n${indent}}`;

const specOf = (fields: readonly Field[]) =>
  Object.fromEntries(fields.map((field) => [field.name, { type: field.type, optional: field.optional }]));

const endpointValue = (endpoint: Endpoint) => ({
  method: endpoint.method,
  path: endpoint.path,
  summary: endpoint.summary,
  domain: endpoint.domain,
  list: endpoint.list,
  screens: [...endpoint.screens],
});

const interfaceOf = (name: string, registry: ApiRegistry, pick: (endpoint: Endpoint) => readonly Field[]): string =>
  [
    `export interface ${name} {`,
    ...registry.endpoints.map((endpoint) => `  ${endpoint.id}: ${shape(pick(endpoint), "  ")};`),
    "}",
  ].join("\n");

export const registryFile = (registry: ApiRegistry): string =>
  [
    imported("type { FieldSpec }", "./validate"),
    "",
    `export const ENDPOINTS = ${printTsValue(Object.fromEntries(registry.endpoints.map((item) => [item.id, endpointValue(item)])), 0, 24)} as const;`,
    "",
    "export type EndpointId = keyof typeof ENDPOINTS;",
    "",
    `export const ENDPOINT_IDS: readonly EndpointId[] = ${printTsValue(
      registry.endpoints.map((item) => item.id),
      0,
      51,
    )};`,
    "",
    interfaceOf("Inputs", registry, (endpoint) => endpoint.input),
    "",
    interfaceOf("Items", registry, (endpoint) => endpoint.output),
    "",
    "export type Output<Id extends EndpointId> =",
    '  (typeof ENDPOINTS)[Id]["list"] extends true ? Items[Id][] : Items[Id];',
    "",
    `export const INPUT_FIELDS: Record<EndpointId, FieldSpec> = ${printTsValue(Object.fromEntries(registry.endpoints.map((item) => [item.id, specOf(item.input)])), 0, 58)};`,
    "",
    `export const OUTPUT_FIELDS: Record<EndpointId, FieldSpec> = ${printTsValue(Object.fromEntries(registry.endpoints.map((item) => [item.id, specOf(item.output)])), 0, 59)};`,
    "",
  ].join("\n");

export const errorsFile = (registry: ApiRegistry): string =>
  [
    `export const ERROR_CODES = ${printTsValue(registry.errors, 0, 27, 10)} as const;`,
    "",
    "export type ErrorCode = (typeof ERROR_CODES)[number];",
    "",
    "export interface ApiError {",
    "  error: {",
    "    code: ErrorCode;",
    "    message: string;",
    "  };",
    "}",
    "",
    `export const ERROR_STATUS: Record<ErrorCode, number> = ${printTsValue(Object.fromEntries(registry.errors.map((code) => [code, STATUS[code] ?? 400])), 0, 0)};`,
    "",
    "export const isErrorCode = (value: string): value is ErrorCode =>",
    "  ERROR_CODES.some((code) => code === value);",
    "",
    "export const apiError = (code: ErrorCode, message: string): ApiError => ({",
    "  error: { code, message },",
    "});",
    "",
  ].join("\n");

export const VALIDATE_FILE = [
  "export type FieldType =",
  '  "string" | "number" | "boolean" | "string[]" | "number[]";',
  "",
  "export interface FieldRule {",
  "  type: FieldType;",
  "  optional: boolean;",
  "}",
  "",
  "export type FieldSpec = Readonly<Record<string, FieldRule>>;",
  "",
  "const matches = (type: FieldType, value: unknown): boolean => {",
  '  if (type === "string[]")',
  "    return (",
  '      Array.isArray(value) && value.every((item) => typeof item === "string")',
  "    );",
  '  if (type === "number[]")',
  "    return (",
  '      Array.isArray(value) && value.every((item) => typeof item === "number")',
  "    );",
  "  return typeof value === type;",
  "};",
  "",
  "export const fieldErrors = (spec: FieldSpec, value: unknown): string[] => {",
  '  if (typeof value !== "object" || value === null || Array.isArray(value))',
  '    return ["expected an object"];',
  "  const record = new Map<string, unknown>(Object.entries(value));",
  "  return Object.entries(spec).flatMap(([name, rule]) => {",
  "    const item = record.get(name);",
  "    if (item === undefined) return rule.optional ? [] : [`${name} is missing`];",
  "    return matches(rule.type, item) ? [] : [`${name} must be ${rule.type}`];",
  "  });",
  "};",
  "",
].join("\n");

export const CLIENT_FILE = [
  imported("type { ApiError }", "./errors"),
  "import {",
  "  ENDPOINTS,",
  "  type EndpointId,",
  "  type Inputs,",
  "  type Output,",
  "  OUTPUT_FIELDS,",
  closeImport("./registry"),
  imported("{ fieldErrors }", "./validate"),
  "",
  "export type ApiResult<Id extends EndpointId> =",
  "  | { ok: true; data: Output<Id> }",
  '  | { ok: false; status: number; error: ApiError["error"] };',
  "",
  "const isOutput = <Id extends EndpointId>(",
  "  id: Id,",
  "  value: unknown,",
  "): value is Output<Id> => {",
  "  const spec = OUTPUT_FIELDS[id];",
  "  if (!ENDPOINTS[id].list) return fieldErrors(spec, value).length === 0;",
  "  return (",
  "    Array.isArray(value) &&",
  "    value.every((item) => fieldErrors(spec, item).length === 0)",
  "  );",
  "};",
  "",
  "const isApiError = (value: unknown): value is ApiError =>",
  '  typeof value === "object" && value !== null && "error" in value;',
  "",
  "const fillPath = (path: string, input: Map<string, unknown>): string =>",
  "  path.replace(/:([A-Za-z_]\\w*)/g, (_match, name: string) =>",
  '    encodeURIComponent(String(input.get(name) ?? "")),',
  "  );",
  "",
  "export const callApi = async <Id extends EndpointId>(",
  "  id: Id,",
  "  input: Inputs[Id],",
  "  init: RequestInit = {},",
  "  send: typeof fetch = globalThis.fetch.bind(globalThis),",
  "): Promise<ApiResult<Id>> => {",
  "  const endpoint = ENDPOINTS[id];",
  "  const values = new Map<string, unknown>(Object.entries(input));",
  "  const method: string = endpoint.method;",
  '  const hasBody = method !== "GET" && method !== "DELETE";',
  "  const response = await send(fillPath(endpoint.path, values), {",
  "    ...init,",
  "    method: endpoint.method,",
  '    headers: { "content-type": "application/json" },',
  "    ...(hasBody ? { body: JSON.stringify(input) } : {}),",
  "  });",
  "  const body: unknown = await response.json();",
  "  if (response.ok && isOutput(id, body)) return { ok: true, data: body };",
  "  if (isApiError(body))",
  "    return { ok: false, status: response.status, error: body.error };",
  "  throw new Error(`${id}: the response does not match the contract`);",
  "};",
  "",
].join("\n");
