import { posix } from "node:path";

import type { Language } from "./languages.js";

const JS_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
const JS_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;

const stripModule = (path: string): string => path.replace(JS_EXTENSION, "").replace(/\/index$/, "");

const jsSpecifiers = (text: string): readonly string[] =>
  [...text.matchAll(JS_SPECIFIER)].map((match) => match[1] ?? "");

const jsImports = (callerPath: string, callerText: string, origin: string): boolean => {
  const target = stripModule(origin);
  return jsSpecifiers(callerText).some((specifier) => {
    if (specifier.startsWith(".")) {
      return stripModule(posix.normalize(posix.join(posix.dirname(callerPath), specifier))) === target;
    }
    const bare = stripModule(specifier.replace(/^[@~#]\//, ""));
    return target === bare || target.endsWith(`/${bare}`);
  });
};

const pyImports = (callerText: string, origin: string): boolean => {
  const stem = posix.basename(origin).replace(/\.py$/, "");
  const module = stem === "__init__" ? posix.basename(posix.dirname(origin)) : stem;
  const word = new RegExp(`\\b${module}\\b`);
  return callerText.split(/\r?\n/).some((line) => /^\s*(?:from|import)\s/.test(line) && word.test(line));
};

const goImports = (callerPath: string, callerText: string, origin: string): boolean => {
  const dir = posix.dirname(origin);
  if (posix.dirname(callerPath) === dir) return true;
  const last = posix.basename(dir);
  return new RegExp(`"[^"]*\\b${last}"`).test(callerText);
};

export const importsOrigin = (
  language: Language,
  callerPath: string,
  callerText: string,
  origins: readonly string[],
): boolean =>
  origins.some((origin) => {
    if (callerPath === origin) return true;
    switch (language.imports) {
      case "none":
        return true;
      case "package":
        return goImports(callerPath, callerText, origin);
      case "module":
        return language.id === "py" ? pyImports(callerText, origin) : jsImports(callerPath, callerText, origin);
    }
  });
