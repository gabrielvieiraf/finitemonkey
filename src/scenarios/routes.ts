export const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type Method = (typeof METHODS)[number];

export type RouteStyle = "call" | "chain" | "object" | "decorator" | "file" | "viewset";

export interface Route {
  readonly method: Method;
  readonly path: string;
  readonly file: string;
  readonly style: RouteStyle;
}

const CALL = /\.(get|post|put|patch|delete)\(\s*r?["'`](\/[A-Za-z0-9_\-/:{}<>.]*)["'`]/gi;
const CHAIN = /\.route\(\s*["'`](\/[A-Za-z0-9_\-/:{}]*)["'`]\s*\)([^;]*)/gi;
const CHAINED_VERB = /\.(get|post|put|patch|delete)\(/gi;
const OBJECT = /\.route\(\s*\{([^}]*)\}/g;
const OBJECT_URL = /\b(?:url|path)\s*:\s*["'`](\/[A-Za-z0-9_\-/:{}]*)["'`]/;
const OBJECT_METHOD = /\bmethod\s*:\s*(\[[^\]]*\]|["'`][A-Za-z]+["'`])/;
const FLASK = /@\w+(?:\.\w+)*\.route\(\s*r?["'](\/[^"']*)["']([^)]*)\)/g;
const FLASK_METHODS = /methods\s*=\s*[[(]([^\])]*)[\])]/;
const NEST_CONTROLLER = /@Controller\(\s*(?:["'`]([^"'`]*)["'`])?/;
const NEST_VERB = /@(Get|Post|Put|Patch|Delete)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g;
const VIEWSET = /\.register\(\s*r?["']\^?([A-Za-z0-9_\-/]+?)\/?\$?["']\s*,/g;

const methodOf = (word: string | undefined): Method | undefined => METHODS.find((item) => item === word?.toLowerCase());

const methodsIn = (text: string): readonly Method[] =>
  [...text.matchAll(/["'`]([A-Za-z]+)["'`]/g)].flatMap((match) => methodOf(match[1]) ?? []);

export const normalizePath = (path: string): string => {
  const slashed = path.startsWith("/") ? path : `/${path}`;
  return slashed
    .replace(/<(?:[A-Za-z_]+:)?([A-Za-z_][A-Za-z0-9_]*)>/g, ":$1")
    .replace(/\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}/g, ":$1")
    .replace(/\/{2,}/g, "/");
};

const route = (method: Method, path: string, file: string, style: RouteStyle): Route => ({
  method,
  path: normalizePath(path),
  file,
  style,
});

const calls = (file: string, text: string): readonly Route[] =>
  [...text.matchAll(CALL)].flatMap((match) => {
    const method = methodOf(match[1]);
    return method === undefined || match[2] === undefined ? [] : [route(method, match[2], file, "call")];
  });

const chains = (file: string, text: string): readonly Route[] =>
  [...text.matchAll(CHAIN)].flatMap((match) => {
    const path = match[1];
    if (path === undefined) return [];
    return [...(match[2] ?? "").matchAll(CHAINED_VERB)].flatMap((verb) => {
      const method = methodOf(verb[1]);
      return method === undefined ? [] : [route(method, path, file, "chain")];
    });
  });

const objects = (file: string, text: string): readonly Route[] =>
  [...text.matchAll(OBJECT)].flatMap((match) => {
    const body = match[1] ?? "";
    const path = OBJECT_URL.exec(body)?.[1];
    const methods = methodsIn(OBJECT_METHOD.exec(body)?.[1] ?? "");
    return path === undefined ? [] : methods.map((method) => route(method, path, file, "object"));
  });

const flask = (file: string, text: string): readonly Route[] =>
  [...text.matchAll(FLASK)].flatMap((match) => {
    const path = match[1];
    if (path === undefined) return [];
    const listed = FLASK_METHODS.exec(match[2] ?? "")?.[1];
    const methods = listed === undefined ? (["get"] as const) : methodsIn(listed);
    return methods.map((method) => route(method, path, file, "decorator"));
  });

const nest = (file: string, text: string): readonly Route[] => {
  const controller = NEST_CONTROLLER.exec(text);
  if (controller === null) return [];
  const prefix = controller[1] ?? "";
  return [...text.matchAll(NEST_VERB)].flatMap((match) => {
    const method = methodOf(match[1]);
    return method === undefined
      ? []
      : [route(method, `/${prefix}/${match[2] ?? ""}`.replace(/\/$/, ""), file, "decorator")];
  });
};

const viewsets = (file: string, text: string): readonly Route[] =>
  [...text.matchAll(VIEWSET)].flatMap((match) => {
    const base = match[1];
    if (base === undefined) return [];
    const collection = `/${base}/`;
    const item = `/${base}/:pk/`;
    return [
      route("get", collection, file, "viewset"),
      route("post", collection, file, "viewset"),
      ...(["get", "put", "patch", "delete"] as const).map((method) => route(method, item, file, "viewset")),
    ];
  });

export const callRoutes = (file: string, text: string): readonly Route[] => {
  const python = file.endsWith(".py");
  const found = [
    ...calls(file, text),
    ...(python
      ? [...flask(file, text), ...viewsets(file, text)]
      : [...chains(file, text), ...objects(file, text), ...nest(file, text)]),
  ];
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.method} ${item.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
