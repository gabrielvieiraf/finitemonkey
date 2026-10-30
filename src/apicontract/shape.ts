import { parseYaml, type YamlValue } from "../core/yaml/parse.js";

export const STABILITIES = ["public", "internal", "unpublished"] as const;
export const PAGINATION_SCHEMES = ["token", "offset", "page"] as const;
export const NAMING_STYLES = ["camel", "snake"] as const;

export type Stability = (typeof STABILITIES)[number];
export type PaginationScheme = (typeof PAGINATION_SCHEMES)[number];
export type NamingStyle = (typeof NAMING_STYLES)[number];

export interface ShapeField {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
}

export interface EndpointShape {
  readonly error: readonly ShapeField[] | undefined;
  readonly status: readonly number[];
  readonly stability: Stability;
}

export interface ApiShape {
  readonly version: string | undefined;
  readonly errorShape: readonly ShapeField[] | undefined;
  readonly pagination: PaginationScheme | undefined;
  readonly naming: NamingStyle | undefined;
  readonly endpoints: ReadonlyMap<string, EndpointShape>;
}

type YamlMap = Readonly<Record<string, YamlValue>>;

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const scalar = (value: YamlValue | undefined): string | undefined =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : undefined;

const oneOf = <T extends string>(options: readonly T[], value: YamlValue | undefined): T | undefined =>
  options.find((option) => option === scalar(value));

const fieldsOf = (value: YamlValue | undefined): readonly ShapeField[] | undefined => {
  if (!isMap(value)) return undefined;
  return Object.entries(value).map(([name, raw]) => {
    const text = scalar(raw) ?? "";
    return { name, type: text.replace(/\?$/, ""), optional: text.endsWith("?") };
  });
};

const statusOf = (value: YamlValue | undefined): readonly number[] =>
  Array.isArray(value)
    ? value.flatMap((item: YamlValue) => {
        const parsed = Number(scalar(item));
        return Number.isInteger(parsed) ? [parsed] : [];
      })
    : [];

const endpointShape = (value: YamlMap): EndpointShape => ({
  error: fieldsOf(value["error"]),
  status: statusOf(value["status"]),
  stability: oneOf(STABILITIES, value["stability"]) ?? "public",
});

export const EMPTY_SHAPE: ApiShape = {
  version: undefined,
  errorShape: undefined,
  pagination: undefined,
  naming: undefined,
  endpoints: new Map(),
};

export const parseShape = (source: string): ApiShape => {
  const parsed = parseYaml(source);
  if (!parsed.ok || !isMap(parsed.value)) return EMPTY_SHAPE;
  const root = parsed.value;
  const list = root["endpoints"];
  const endpoints = Array.isArray(list)
    ? list.flatMap((item: YamlValue): (readonly [string, EndpointShape])[] => {
        const id = isMap(item) ? scalar(item["id"]) : undefined;
        return isMap(item) && id !== undefined ? [[id, endpointShape(item)]] : [];
      })
    : [];
  return {
    version: scalar(root["version"]),
    errorShape: fieldsOf(root["error_shape"]),
    pagination: oneOf(PAGINATION_SCHEMES, root["pagination"]),
    naming: oneOf(NAMING_STYLES, root["naming"]),
    endpoints: new Map(endpoints),
  };
};

export const shapeKey = (fields: readonly ShapeField[]): string =>
  fields
    .map((field) => field.name)
    .sort()
    .join(",");
