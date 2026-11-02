import { isRecord, parseJson } from "../core/parsed.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import { type Method, METHODS } from "../scenarios/plan.js";
import type { HttpRequest, Send } from "../scenarios/run.js";
import { schemeOf } from "./consistency.js";
import type { ApiRegistry, Endpoint, Field } from "./registry.js";
import { type ApiShape, type PaginationScheme, shapeKey } from "./shape.js";

export interface LiveConfig {
  readonly start: string | undefined;
  readonly port: number;
  readonly base: string;
}

export type LiveProblem =
  | { readonly kind: "live_error_shapes"; readonly shapes: string }
  | {
      readonly kind: "live_error_shape_mismatch";
      readonly id: string;
      readonly shape: string;
      readonly declared: string;
    }
  | { readonly kind: "live_pagination"; readonly id: string; readonly scheme: string };

export interface LiveCall {
  readonly id: string;
  readonly probe: "mock" | "error";
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  readonly body: string;
}

const PARAM = /:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const MISSING_ID = "finitemonkey-missing-0";
const RESPONSE_FIELDS: Readonly<Record<PaginationScheme, readonly string[]>> = {
  token: ["nextpagetoken", "nextcursor", "nexttoken", "cursor", "pagetoken", "next"],
  offset: ["total", "totalcount", "offset", "nextoffset", "hasmore", "count"],
  page: ["page", "totalpages", "nextpage", "total", "hasmore"],
};

const text = (tree: ConfigTree, key: string): string => {
  const value = configAt(tree, "api", key);
  return typeof value === "string" ? value.trim() : "";
};

export const liveConfig = (tree: ConfigTree): LiveConfig | undefined => {
  const port = Number.parseInt(text(tree, "port"), 10);
  if (!Number.isInteger(port) || port <= 0) return undefined;
  const start = text(tree, "start");
  return { start: start === "" ? undefined : start, port, base: text(tree, "base").replace(/\/$/, "") };
};

const mockValue = (field: Field): unknown => {
  if (field.type === "number") return 1;
  if (field.type === "boolean") return true;
  if (field.type === "string[]") return ["example"];
  if (field.type === "number[]") return [1];
  return "example";
};

const fillPath = (endpoint: Endpoint, value: (name: string) => string): string =>
  endpoint.path.replace(PARAM, (_match, colon: string | undefined, brace: string | undefined) =>
    encodeURIComponent(value(colon ?? brace ?? "")),
  );

const paramNames = (endpoint: Endpoint): ReadonlySet<string> =>
  new Set([...endpoint.path.matchAll(PARAM)].map((match) => match[1] ?? match[2] ?? ""));

const methodOf = (endpoint: Endpoint): Method =>
  METHODS.find((method) => method === endpoint.method.toLowerCase()) ?? "get";

const sendsBody = (endpoint: Endpoint): boolean => ["POST", "PUT", "PATCH"].includes(endpoint.method);

const mockRequest = (endpoint: Endpoint, base: string): HttpRequest => {
  const params = paramNames(endpoint);
  const fields = endpoint.input.filter((field) => !params.has(field.name));
  const path = fillPath(endpoint, (name) => {
    const field = endpoint.input.find((item) => item.name === name);
    return field === undefined ? "1" : String(mockValue(field));
  });
  const method = methodOf(endpoint);
  if (sendsBody(endpoint)) {
    const body = JSON.stringify(Object.fromEntries(fields.map((field) => [field.name, mockValue(field)])));
    return { method, path: `${base}${path}`, headers: {}, body };
  }
  const query = new URLSearchParams(
    fields.filter((field) => !field.optional).map((field): [string, string] => [field.name, String(mockValue(field))]),
  ).toString();
  return { method, path: `${base}${path}${query === "" ? "" : `?${query}`}`, headers: {} };
};

const errorRequest = (endpoint: Endpoint, base: string): HttpRequest | undefined => {
  const method = methodOf(endpoint);
  if (paramNames(endpoint).size > 0)
    return {
      method,
      path: `${base}${fillPath(endpoint, () => MISSING_ID)}`,
      headers: {},
      ...(sendsBody(endpoint) ? { body: "{}" } : {}),
    };
  if (sendsBody(endpoint) && endpoint.input.some((field) => !field.optional))
    return { method, path: `${base}${endpoint.path}`, headers: {}, body: "{}" };
  return undefined;
};

export const runLive = async (registry: ApiRegistry, base: string, send: Send): Promise<readonly LiveCall[]> => {
  const calls: LiveCall[] = [];
  for (const endpoint of registry.endpoints) {
    const planned = [
      ["mock", mockRequest(endpoint, base)],
      ["error", errorRequest(endpoint, base)],
    ] as const;
    for (const [probe, request] of planned) {
      if (request === undefined) continue;
      const answer = await send(request);
      calls.push({
        id: endpoint.id,
        probe,
        method: endpoint.method,
        path: request.path,
        status: answer?.status ?? null,
        body: answer?.body ?? "",
      });
    }
  }
  return calls;
};

const objectOf = (body: string): Readonly<Record<string, unknown>> | unknown[] | undefined => {
  const parsed = parseJson(body);
  if (!parsed.ok) return undefined;
  return Array.isArray(parsed.value) || isRecord(parsed.value) ? parsed.value : undefined;
};

const keysOf = (value: Readonly<Record<string, unknown>>): string => `{${Object.keys(value).sort().join(",")}}`;

const squash = (name: string): string => name.toLowerCase().replace(/_/g, "");

const errorShapes = (registry: ApiRegistry, shape: ApiShape, calls: readonly LiveCall[]): readonly LiveProblem[] => {
  const seen = calls.flatMap((call): (readonly [string, string])[] => {
    const body = call.status !== null && call.status >= 400 ? objectOf(call.body) : undefined;
    return body === undefined || Array.isArray(body) ? [] : [[keysOf(body), call.id]];
  });
  if (shape.errorShape !== undefined) {
    const declared = `{${shapeKey(shape.errorShape)}}`;
    const wrong = new Map(seen.filter(([key]) => key !== declared).map(([key, id]) => [`${id} ${key}`, { key, id }]));
    return [...wrong.values()].map(({ key, id }) => ({ kind: "live_error_shape_mismatch", id, shape: key, declared }));
  }
  const declaredPerEndpoint = registry.endpoints.flatMap((endpoint): (readonly [string, string])[] => {
    const error = shape.endpoints.get(endpoint.id)?.error;
    return error === undefined ? [] : [[`{${shapeKey(error)}}`, `${endpoint.id} (contract)`]];
  });
  const all = [...declaredPerEndpoint, ...seen];
  if (new Set(all.map(([key]) => key)).size <= 1) return [];
  const groups = new Map<string, Set<string>>();
  for (const [key, id] of all) groups.set(key, new Set([...(groups.get(key) ?? []), id]));
  const shapes = [...groups].map(([key, ids]) => `${key}: ${[...ids].join(", ")}`).join("; ");
  return [{ kind: "live_error_shapes", shapes }];
};

const paginationProblems = (
  registry: ApiRegistry,
  shape: ApiShape,
  calls: readonly LiveCall[],
): readonly LiveProblem[] =>
  registry.endpoints
    .filter((endpoint) => endpoint.list)
    .flatMap((endpoint): LiveProblem[] => {
      const call = calls.find((item) => item.id === endpoint.id && item.probe === "mock");
      const status = call?.status ?? 0;
      if (call === undefined || status < 200 || status >= 300) return [];
      const body = objectOf(call.body);
      const scheme = shape.pagination ?? schemeOf(endpoint);
      if (body === undefined) return [];
      if (Array.isArray(body)) return [{ kind: "live_pagination", id: endpoint.id, scheme: scheme ?? "none" }];
      if (scheme === undefined) return [];
      const keys = Object.keys(body).map(squash);
      return RESPONSE_FIELDS[scheme].some((field) => keys.includes(field))
        ? []
        : [{ kind: "live_pagination", id: endpoint.id, scheme }];
    });

export const liveProblems = (
  registry: ApiRegistry,
  shape: ApiShape,
  calls: readonly LiveCall[],
): readonly LiveProblem[] => [...errorShapes(registry, shape, calls), ...paginationProblems(registry, shape, calls)];
