import { stripComments } from "./cycles.js";

const PATTERNS = [
  /(?:^|[\s;])import\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g,
  /(?:^|[\s;])export\s+(?:type\s+)?[\w*{}\s,$]*?\s+from\s+["']([^"']+)["']/g,
  /\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g,
];

export interface PackageSpecifier {
  readonly specifier: string;
  readonly name: string;
  readonly subpath: string;
}

export const moduleSpecifiers = (text: string): readonly string[] => {
  const code = stripComments(text);
  return [...new Set(PATTERNS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1] ?? "")))];
};

const ALIAS = /^(?:[.#~/]|@\/|[a-z][\w+.-]*:)/;

export const packageSpecifier = (specifier: string): PackageSpecifier | undefined => {
  if (specifier === "" || ALIAS.test(specifier)) return undefined;
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  if (parts.length < size || parts.slice(0, size).some((part) => part === "")) return undefined;
  return { specifier, name: parts.slice(0, size).join("/"), subpath: parts.slice(size).join("/") };
};

export const lineOfText = (text: string, needle: string): number => {
  const index = text.indexOf(needle);
  return index < 0 ? 1 : text.slice(0, index).split("\n").length;
};
