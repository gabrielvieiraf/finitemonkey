import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree } from "../git/project-config.js";

export const SCENARIOS_FEATURE = "access-scenarios";
export const SCENARIOS_SCHEMA = "finitemonkey/scenarios@1";
export const LOCALHOST = "127.0.0.1";

export const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type Method = (typeof METHODS)[number];

export interface Route {
  readonly method: Method;
  readonly path: string;
  readonly file: string;
}

export interface Resource {
  readonly name: string;
  readonly collection: string;
  readonly item: string;
  readonly methods: readonly Method[];
}

export type Actor = "A" | "B" | "anonymous";

export type ScenarioKind = "owner_reads" | "other_reads" | "other_changes" | "other_deletes" | "anonymous_reads";

export interface Scenario {
  readonly id: string;
  readonly kind: ScenarioKind;
  readonly resource: string;
  readonly actor: Actor;
  readonly method: Method;
  readonly path: string;
  readonly allowed: boolean;
}

export interface AccessConfig {
  readonly start: string | undefined;
  readonly port: number;
  readonly userA: string;
  readonly userB: string;
  readonly body: string;
  readonly idField: string;
}

const ROUTE = /\.(get|post|put|patch|delete)\(\s*["'`](\/[A-Za-z0-9_\-/:{}]*)["'`]/gi;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIR = /(?:^|\/)(?:node_modules|\.git|dist|build|coverage|\.finitemonkey)\//;
const PARAM = /\/(?::[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;
const MAX_FILES = 2000;

export const routesIn = (file: string, text: string): readonly Route[] =>
  [...text.matchAll(ROUTE)].flatMap((match) => {
    const method = METHODS.find((item) => item === match[1]?.toLowerCase());
    const path = match[2];
    return method === undefined || path === undefined ? [] : [{ method, path, file }];
  });

export const isRouteFile = (file: string, text: string): boolean =>
  SOURCE.test(file) && routesIn(file, text).length > 0;

export const scanRoutes = (runtime: Pick<Runtime, "walkFiles" | "readText">, root: AbsolutePath): readonly Route[] => {
  const files = runtime.walkFiles(root);
  if (!files.ok) return [];
  return files.value
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => SOURCE.test(file) && !SKIP_DIR.test(`/${file}`))
    .slice(0, MAX_FILES)
    .flatMap((file) => {
      const text = runtime.readText(toAbsolutePath(join(root, file)));
      return text.ok ? routesIn(file, text.value) : [];
    });
};

const singular = (word: string): string =>
  word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") ? word.slice(0, -1) : word;

export const resourcesOf = (routes: readonly Route[]): readonly Resource[] => {
  const items = routes.filter((route) => PARAM.test(route.path));
  const collections = new Set(routes.filter((route) => route.method === "post").map((route) => route.path));
  const byItem = new Map<string, Method[]>();
  for (const route of items) byItem.set(route.path, [...(byItem.get(route.path) ?? []), route.method]);
  return [...byItem.entries()].flatMap(([item, methods]): Resource[] => {
    const collection = item.replace(PARAM, "") || "/";
    if (!collections.has(collection) || !methods.includes("get")) return [];
    const name = singular(
      collection
        .split("/")
        .filter((part) => part !== "")
        .at(-1) ?? "item",
    );
    return [{ name, collection, item, methods: [...new Set(methods)] }];
  });
};

export const scenariosFor = (resource: Resource): readonly Scenario[] => {
  const base = { resource: resource.name, path: resource.item };
  const change = resource.methods.find((method) => method === "patch" || method === "put");
  return [
    { ...base, id: `${resource.name}.owner_reads`, kind: "owner_reads", actor: "A", method: "get", allowed: true },
    { ...base, id: `${resource.name}.other_reads`, kind: "other_reads", actor: "B", method: "get", allowed: false },
    ...(change === undefined
      ? []
      : [
          {
            ...base,
            id: `${resource.name}.other_changes`,
            kind: "other_changes" as const,
            actor: "B" as const,
            method: change,
            allowed: false,
          },
        ]),
    ...(resource.methods.includes("delete")
      ? [
          {
            ...base,
            id: `${resource.name}.other_deletes`,
            kind: "other_deletes" as const,
            actor: "B" as const,
            method: "delete" as const,
            allowed: false,
          },
        ]
      : []),
    {
      ...base,
      id: `${resource.name}.anonymous_reads`,
      kind: "anonymous_reads",
      actor: "anonymous",
      method: "get",
      allowed: false,
    },
  ];
};

const text = (tree: ConfigTree, key: string, fallback: string): string => {
  const value = configAt(tree, "access", key);
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
};

export const accessConfig = (tree: ConfigTree): AccessConfig | undefined => {
  const port = Number.parseInt(text(tree, "port", ""), 10);
  const userA = text(tree, "user_a", "");
  const userB = text(tree, "user_b", "");
  if (!Number.isInteger(port) || port <= 0 || userA === "" || userB === "") return undefined;
  const start = text(tree, "start", "");
  return {
    start: start === "" ? undefined : start,
    port,
    userA,
    userB,
    body: text(tree, "body", "{}"),
    idField: text(tree, "id_field", "id"),
  };
};
