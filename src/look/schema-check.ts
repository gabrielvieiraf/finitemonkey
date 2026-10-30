import { isRecord } from "../core/parsed.js";

export interface JsonSchema {
  readonly type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  readonly enum?: readonly string[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly additionalProperties?: boolean | JsonSchema;
  readonly items?: JsonSchema;
  readonly minimum?: number;
  readonly minLength?: number;
  readonly description?: string;
}

const CHECKS: Readonly<Record<NonNullable<JsonSchema["type"]>, (value: unknown) => boolean>> = {
  object: isRecord,
  array: Array.isArray,
  string: (value) => typeof value === "string",
  integer: (value) => typeof value === "number" && Number.isInteger(value),
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
};

const typeOk = (schema: JsonSchema, value: unknown): boolean =>
  schema.type === undefined ? true : CHECKS[schema.type](value);

const objectErrors = (schema: JsonSchema, value: Readonly<Record<string, unknown>>, at: string): readonly string[] => {
  const properties = schema.properties ?? {};
  const missing = (schema.required ?? []).filter((key) => !(key in value)).map((key) => `${at}.${key}: required`);
  const fields = Object.entries(value).flatMap(([key, item]) => {
    const known = properties[key];
    if (known !== undefined) return validate(known, item, `${at}.${key}`);
    const extra = schema.additionalProperties;
    if (extra === false) return [`${at}.${key}: unknown key`];
    return typeof extra === "object" ? validate(extra, item, `${at}.${key}`) : [];
  });
  return [...missing, ...fields];
};

export const validate = (schema: JsonSchema, value: unknown, at = "$"): readonly string[] => {
  if (!typeOk(schema, value)) return [`${at}: must be ${schema.type ?? "valid"}`];
  if (schema.enum !== undefined && !schema.enum.some((item) => item === value))
    return [`${at}: must be one of ${schema.enum.join(", ")}`];
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum)
    return [`${at}: must be at least ${String(schema.minimum)}`];
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength)
    return [`${at}: must not be empty`];
  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items;
    return value.flatMap((item: unknown, index) => validate(items, item, `${at}[${String(index)}]`));
  }
  return isRecord(value) ? objectErrors(schema, value, at) : [];
};
