import { nameIn } from "../map/defs.js";

export const GENERIC_NAMES: ReadonlySet<string> = new Set(
  [
    "get",
    "set",
    "init",
    "render",
    "handle",
    "handler",
    "main",
    "index",
    "run",
    "start",
    "stop",
    "create",
    "update",
    "delete",
    "remove",
    "load",
    "save",
    "parse",
    "format",
    "default",
    "props",
    "config",
    "setup",
    "app",
    "helper",
    "helpers",
    "utils",
    "util",
    "test",
    "data",
    "value",
    "result",
    "item",
    "items",
    "list",
    "map",
    "filter",
    "reduce",
    "constructor",
    "options",
    "state",
    "context",
    "provider",
    "component",
    "page",
    "layout",
    "schema",
    "types",
    "type",
    "error",
    "errors",
    "request",
    "response",
    "client",
    "server",
    "router",
    "routes",
    "store",
    "model",
    "service",
    "controller",
    "validate",
    "transform",
    "fetch",
    "post",
    "put",
    "patch",
    "use",
    "on",
    "off",
    "emit",
    "logger",
    "log",
    "new",
    "build",
    "make",
    "of",
    "from",
    "to",
    "id",
    "name",
    "key",
  ].map((name) => name.toLowerCase()),
);

const MIN_LENGTH = 4;

export const normalizeName = (name: string): string => name.toLowerCase().replace(/[_-]/g, "");

export const isGeneric = (name: string): boolean => {
  const normalized = normalizeName(name);
  return normalized.length < MIN_LENGTH || GENERIC_NAMES.has(normalized);
};

export const definedNames = (text: string): readonly string[] =>
  text.split(/\r?\n/).flatMap((line) => {
    const name = nameIn(line);
    return name === undefined ? [] : [name];
  });

export const newDefinitions = (before: string, after: string): readonly string[] => {
  const old = new Set(definedNames(before).map(normalizeName));
  return [...new Set(definedNames(after))].filter((name) => !old.has(normalizeName(name)) && !isGeneric(name));
};
