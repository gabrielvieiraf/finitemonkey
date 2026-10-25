import { posix } from "node:path";

import { toPosixPath } from "../core/posix-path.js";

const MAGIC = /^:(?:\(([^)]*)\)|([!^/]*))(.*)$/s;
const GLOB = /[*?[]/;

interface Spec {
  readonly pattern: string;
  readonly exclude: boolean;
}

const specOf = (raw: string, prefix: string): Spec => {
  const posixRaw = toPosixPath(raw);
  const magic = MAGIC.exec(posixRaw);
  const words = magic === null ? "" : (magic[1] ?? magic[2] ?? "");
  const rest = magic === null ? posixRaw : (magic[3] ?? "");
  const exclude = /(?:^|,)exclude(?:,|$)|[!^]/.test(words);
  const top = /(?:^|,)top(?:,|$)|\//.test(words);
  const joined = posix.normalize(top ? rest : posix.join(prefix === "" ? "." : prefix, rest));
  return { pattern: joined === "./" ? "." : joined.replace(/\/$/, ""), exclude };
};

const globRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}(?:/.*)?$`);
};

const matchesOne = (file: string, pattern: string): boolean => {
  if (pattern === "." || pattern === "") return true;
  if (GLOB.test(pattern)) return globRegex(pattern).test(file);
  return file === pattern || file.startsWith(`${pattern}/`);
};

export const matchPathspecs = (file: string, specs: readonly string[], prefix: string): boolean => {
  const parsed = specs.map((raw) => specOf(raw, prefix));
  const include = parsed.filter((spec) => !spec.exclude);
  const included = include.length === 0 || include.some((spec) => matchesOne(file, spec.pattern));
  return included && !parsed.some((spec) => spec.exclude && matchesOne(file, spec.pattern));
};

export const isBroadPathspec = (spec: string): boolean => {
  const posixSpec = toPosixPath(spec);
  return posixSpec === "." || posixSpec === "./" || posixSpec === ":/" || posixSpec === "*" || GLOB.test(posixSpec);
};
