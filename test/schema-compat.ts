import { isRecord } from "../src/core/parsed.js";

type Schema = Readonly<Record<string, unknown>>;

const asSchema = (value: unknown): Schema => (isRecord(value) ? value : {});

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const names = (value: unknown): readonly string[] => list(value).filter((item) => typeof item === "string");

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const scalarProblems = (frozen: Schema, current: Schema, path: string): readonly string[] => {
  const problems: string[] = [];
  if (!same(frozen["type"], current["type"])) problems.push(`${path} changed type`);
  if ("const" in frozen && !same(frozen["const"], current["const"])) problems.push(`${path} changed its constant`);
  const allowed = list(current["enum"]);
  for (const value of list(frozen["enum"])) {
    if (!allowed.some((item) => same(item, value))) problems.push(`${path} no longer allows ${JSON.stringify(value)}`);
  }
  const branches = list(current["anyOf"]);
  for (const branch of list(frozen["anyOf"])) {
    if (!branches.some((item) => same(item, branch))) problems.push(`${path} lost a variant`);
  }
  return problems;
};

export const compatProblems = (frozenValue: unknown, currentValue: unknown, path = "$"): readonly string[] => {
  const frozen = asSchema(frozenValue);
  const current = asSchema(currentValue);
  const problems = [...scalarProblems(frozen, current, path)];
  const before = asSchema(frozen["properties"]);
  const after = asSchema(current["properties"]);
  const required = names(current["required"]);
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      problems.push(`${path}.${key} was removed or renamed`);
      continue;
    }
    if (names(frozen["required"]).includes(key) && !required.includes(key)) {
      problems.push(`${path}.${key} is no longer required`);
    }
    problems.push(...compatProblems(before[key], after[key], `${path}.${key}`));
  }
  if ("items" in frozen) problems.push(...compatProblems(frozen["items"], current["items"], `${path}[]`));
  if ("additionalProperties" in frozen) {
    problems.push(...compatProblems(frozen["additionalProperties"], current["additionalProperties"], `${path}{}`));
  }
  return problems;
};

const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

const objectProblems = (schema: Schema, value: Readonly<Record<string, unknown>>, path: string): string[] => {
  const problems: string[] = [];
  const properties = asSchema(schema["properties"]);
  for (const key of names(schema["required"])) if (!(key in value)) problems.push(`${path}.${key} is missing`);
  for (const [key, item] of Object.entries(value)) {
    if (key in properties) problems.push(...validate(properties[key], item, `${path}.${key}`));
    else if ("additionalProperties" in schema) {
      problems.push(...validate(schema["additionalProperties"], item, `${path}.${key}`));
    }
  }
  return problems;
};

export const validate = (schemaValue: unknown, value: unknown, path = "$"): readonly string[] => {
  const schema = asSchema(schemaValue);
  if ("anyOf" in schema) {
    return list(schema["anyOf"]).some((branch) => validate(branch, value, path).length === 0)
      ? []
      : [`${path} matches no variant`];
  }
  if ("const" in schema)
    return same(schema["const"], value) ? [] : [`${path} is not ${JSON.stringify(schema["const"])}`];
  const expected = schema["type"];
  if (typeof expected === "string" && typeOf(value) !== expected)
    return [`${path} is ${typeOf(value)}, not ${expected}`];
  if ("enum" in schema && !list(schema["enum"]).some((item) => same(item, value))) {
    return [`${path} is outside its enum`];
  }
  if (Array.isArray(value))
    return value.flatMap((item, index) => validate(schema["items"], item, `${path}[${String(index)}]`));
  return isRecord(value) ? objectProblems(schema, value, path) : [];
};
