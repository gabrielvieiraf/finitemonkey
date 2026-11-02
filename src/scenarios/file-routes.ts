import { type Method, METHODS, normalizePath, type Route } from "./routes.js";

const NEXT_APP = /^(?:.*\/)?(?:src\/)?app\/(.*?)\/?route\.(?:[cm]?[jt]sx?)$/;
const NEXT_PAGES = /^(?:.*\/)?(?:src\/)?pages\/(api\/.*)\.(?:[cm]?[jt]sx?)$/;
const SVELTE = /^(?:.*\/)?src\/routes\/(.*?)\/?\+server\.(?:[jt]s)$/;
const NITRO = /^(?:.*\/)?server\/(api|routes)\/(.*?)(?:\.(get|post|put|patch|delete))?\.(?:[jt]s)$/;
const EXPORTED = /export\s+(?:async\s+)?(?:function|const|let)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
const EXPORT_LIST = /export\s*\{([^}]*)\}/g;
const LISTED = /\bas\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
const BRANCH = /["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g;
const CATCH_ALL = /\[\[?\.\.\./;

const lower = (word: string | undefined): Method | undefined => METHODS.find((item) => item === word?.toLowerCase());

const segments = (raw: string): string | undefined => {
  if (CATCH_ALL.test(raw)) return undefined;
  const parts = raw
    .split("/")
    .filter((part) => part !== "" && part !== "index" && !/^\(.*\)$/.test(part) && !part.startsWith("@"))
    .map((part) => part.replace(/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/, ":$1"));
  return normalizePath(parts.join("/"));
};

const exportedMethods = (text: string): readonly Method[] => {
  const direct = [...text.matchAll(EXPORTED)].map((match) => match[1]);
  const listed = [...text.matchAll(EXPORT_LIST)].flatMap((match) =>
    [...(match[1] ?? "").matchAll(LISTED)].map((item) => item[1]),
  );
  return [...new Set([...direct, ...listed].flatMap((word) => lower(word) ?? []))];
};

const branchedMethods = (text: string): readonly Method[] => {
  const found = [...new Set([...text.matchAll(BRANCH)].flatMap((match) => lower(match[1]) ?? []))];
  return found.length > 0 ? found : METHODS;
};

const build = (file: string, path: string | undefined, methods: readonly Method[]): readonly Route[] =>
  path === undefined ? [] : methods.map((method) => ({ method, path, file, style: "file" as const }));

export const fileRoutes = (file: string, text: string): readonly Route[] => {
  const app = NEXT_APP.exec(file);
  if (app !== null) return build(file, segments(app[1] ?? ""), exportedMethods(text));
  const svelte = SVELTE.exec(file);
  if (svelte !== null) return build(file, segments(svelte[1] ?? ""), exportedMethods(text));
  const pages = NEXT_PAGES.exec(file);
  if (pages !== null) return build(file, segments(pages[1] ?? ""), branchedMethods(text));
  const nitro = NITRO.exec(file);
  if (nitro === null) return [];
  const prefix = nitro[1] === "api" ? "api/" : "";
  const method = lower(nitro[3]);
  return build(file, segments(`${prefix}${nitro[2] ?? ""}`), method === undefined ? branchedMethods(text) : [method]);
};
