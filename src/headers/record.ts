import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { lookDir } from "../look/paths.js";
import type { FmPaths } from "../task/paths.js";
import type { RouteHeaders } from "./rules.js";

export const HEADERS_FILE = "headers.json";
export const HEADERS_FEATURE = "headers";

export const headersPath = (paths: FmPaths, tree: string): AbsolutePath =>
  toAbsolutePath(join(lookDir(paths, tree), HEADERS_FILE));

export interface HeadersRecord {
  readonly at: string;
  readonly https: boolean;
  readonly routes: readonly RouteHeaders[];
}

export const writeHeaders = (
  runtime: Pick<Runtime, "mkdir" | "writeAtomic">,
  paths: FmPaths,
  tree: string,
  record: HeadersRecord,
): void => {
  const made = runtime.mkdir(lookDir(paths, tree));
  if (made.ok) runtime.writeAtomic(headersPath(paths, tree), `${JSON.stringify(record, null, 2)}\n`);
};

const routeOf = (value: unknown): RouteHeaders | undefined => {
  if (!isRecord(value) || typeof value["route"] !== "string" || typeof value["status"] !== "number") return undefined;
  const headers = isRecord(value["headers"]) ? value["headers"] : {};
  return {
    route: value["route"],
    status: value["status"],
    headers: Object.fromEntries(
      Object.entries(headers).flatMap(([name, text]) => (typeof text === "string" ? [[name, text]] : [])),
    ),
  };
};

export const readHeaders = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  tree: string,
): HeadersRecord | undefined => {
  const text = runtime.readText(headersPath(paths, tree));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return undefined;
  const { at, https, routes } = parsed.value;
  if (typeof at !== "string" || !Array.isArray(routes)) return undefined;
  return { at, https: https === true, routes: routes.flatMap((route: unknown) => routeOf(route) ?? []) };
};
