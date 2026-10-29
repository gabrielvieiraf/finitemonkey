import type { ApiRegistry, Endpoint } from "./registry.js";
import { type ApiShape, type NamingStyle, type PaginationScheme, shapeKey } from "./shape.js";

export const API_CONSISTENCY_FEATURE = "api-consistency";

export type ConsistencyProblem =
  | { readonly kind: "error_shapes"; readonly shapes: string }
  | { readonly kind: "error_shape_mismatch"; readonly id: string; readonly shape: string; readonly declared: string }
  | { readonly kind: "pagination_schemes"; readonly schemes: string }
  | { readonly kind: "pagination_mismatch"; readonly id: string; readonly scheme: string; readonly declared: string }
  | { readonly kind: "page_token_required"; readonly id: string; readonly field: string }
  | { readonly kind: "naming_mixed"; readonly camel: string; readonly snake: string }
  | { readonly kind: "naming_mismatch"; readonly id: string; readonly field: string; readonly declared: string }
  | { readonly kind: "status_invalid"; readonly id: string; readonly status: number }
  | { readonly kind: "status_no_success"; readonly id: string };

const SCHEME_FIELDS: Readonly<Record<PaginationScheme, readonly string[]>> = {
  token: ["pagetoken", "cursor", "starttoken", "nexttoken"],
  offset: ["offset", "skip"],
  page: ["page", "pagenumber", "pageno"],
};

const squash = (name: string): string => name.toLowerCase().replace(/_/g, "");

const schemeOf = (endpoint: Endpoint): PaginationScheme | undefined =>
  (Object.keys(SCHEME_FIELDS) as PaginationScheme[]).find((scheme) =>
    endpoint.input.some((field) => SCHEME_FIELDS[scheme].includes(squash(field.name))),
  );

export const styleOf = (name: string): NamingStyle | undefined => {
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(name)) return "snake";
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(name)) return "camel";
  return undefined;
};

const grouped = (pairs: readonly (readonly [string, string])[]): string => {
  const groups = new Map<string, string[]>();
  for (const [key, id] of pairs) groups.set(key, [...(groups.get(key) ?? []), id]);
  return [...groups].map(([key, ids]) => `${key}: ${ids.join(", ")}`).join("; ");
};

const errorProblems = (registry: ApiRegistry, shape: ApiShape): readonly ConsistencyProblem[] => {
  const declared = shape.errorShape === undefined ? undefined : shapeKey(shape.errorShape);
  const shapes = registry.endpoints.flatMap((endpoint): (readonly [string, string])[] => {
    const error = shape.endpoints.get(endpoint.id)?.error;
    return error === undefined ? [] : [[`{${shapeKey(error)}}`, endpoint.id]];
  });
  if (declared !== undefined)
    return shapes
      .filter(([key]) => key !== `{${declared}}`)
      .map(([key, id]) => ({ kind: "error_shape_mismatch", id, shape: key, declared: `{${declared}}` }));
  return new Set(shapes.map(([key]) => key)).size > 1 ? [{ kind: "error_shapes", shapes: grouped(shapes) }] : [];
};

const paginationProblems = (registry: ApiRegistry, shape: ApiShape): readonly ConsistencyProblem[] => {
  const lists = registry.endpoints.filter((endpoint) => endpoint.list);
  const schemes = lists.flatMap((endpoint): (readonly [string, string])[] => {
    const scheme = schemeOf(endpoint);
    return scheme === undefined ? [] : [[scheme, endpoint.id]];
  });
  const required = lists.flatMap((endpoint): ConsistencyProblem[] =>
    endpoint.input
      .filter((field) => SCHEME_FIELDS.token.includes(squash(field.name)) && !field.optional)
      .map((field) => ({ kind: "page_token_required", id: endpoint.id, field: field.name })),
  );
  const declared = shape.pagination;
  const mixed: readonly ConsistencyProblem[] =
    declared !== undefined
      ? schemes
          .filter(([scheme]) => scheme !== declared)
          .map(([scheme, id]) => ({ kind: "pagination_mismatch", id, scheme, declared }))
      : new Set(schemes.map(([scheme]) => scheme)).size > 1
        ? [{ kind: "pagination_schemes", schemes: grouped(schemes) }]
        : [];
  return [...mixed, ...required];
};

const namingProblems = (registry: ApiRegistry, shape: ApiShape): readonly ConsistencyProblem[] => {
  const named = registry.endpoints.flatMap((endpoint) =>
    [...endpoint.input, ...endpoint.output, ...(shape.endpoints.get(endpoint.id)?.error ?? [])].flatMap(
      (field): { readonly id: string; readonly field: string; readonly style: NamingStyle }[] => {
        const style = styleOf(field.name);
        return style === undefined ? [] : [{ id: endpoint.id, field: field.name, style }];
      },
    ),
  );
  const declared = shape.naming;
  if (declared !== undefined)
    return named
      .filter((item) => item.style !== declared)
      .map((item) => ({ kind: "naming_mismatch", id: item.id, field: item.field, declared }));
  const sample = (style: NamingStyle): string =>
    [...new Set(named.filter((item) => item.style === style).map((item) => `${item.id}.${item.field}`))]
      .slice(0, 3)
      .join(", ");
  const camel = sample("camel");
  const snake = sample("snake");
  return camel !== "" && snake !== "" ? [{ kind: "naming_mixed", camel, snake }] : [];
};

const statusProblems = (registry: ApiRegistry, shape: ApiShape): readonly ConsistencyProblem[] =>
  registry.endpoints.flatMap((endpoint): ConsistencyProblem[] => {
    const status = shape.endpoints.get(endpoint.id)?.status ?? [];
    if (status.length === 0) return [];
    const invalid = status
      .filter((code) => code < 100 || code > 599)
      .map((code): ConsistencyProblem => ({ kind: "status_invalid", id: endpoint.id, status: code }));
    const success = status.some((code) => code >= 200 && code < 300);
    return [...invalid, ...(success ? [] : [{ kind: "status_no_success" as const, id: endpoint.id }])];
  });

export const consistencyProblems = (registry: ApiRegistry, shape: ApiShape): readonly ConsistencyProblem[] => [
  ...errorProblems(registry, shape),
  ...paginationProblems(registry, shape),
  ...namingProblems(registry, shape),
  ...statusProblems(registry, shape),
];
