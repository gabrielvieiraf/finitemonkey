import { isAbsolute, relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
import { matchesAny } from "../core/glob.js";
import { toPosixPath } from "../core/posix-path.js";

export interface Deviation {
  readonly file: string;
  readonly area: string;
}

export const relativeFile = (root: string, target: string): string | undefined => {
  const rel = relative(root, toAbsolutePath(target, toAbsolutePath(root)));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const posix = toPosixPath(rel);
  return posix.startsWith(`${DATA_DIR}/`) || posix.startsWith(".git/") ? undefined : posix;
};

const scopeGlobs = (paths: readonly string[]): readonly string[] =>
  paths.flatMap((path) => (path.endsWith("/") ? [path, `${path}**`] : [path, `${path}/**`]));

export const deviationOf = (root: AbsolutePath, scope: readonly string[], target: string): Deviation | undefined => {
  const file = relativeFile(root, target);
  if (file === undefined || scope.length === 0 || matchesAny(file, scopeGlobs(scope))) return undefined;
  return { file, area: file.includes("/") ? file.slice(0, file.indexOf("/")) : file };
};

const EXTENSION = /[A-Za-z_][\w-]*\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const PATH_CHARS = /^[\w@./-]+$/;
const EDGE = /^[(`"'<[]+|[)`"'>\],;:!?.]+$/g;

export const pathMentions = (prompt: string, exists: (relativePath: string) => boolean): readonly string[] => {
  const tokens = prompt.split(/[\s`"'()<>[\]]+/).map((token) => token.replace(EDGE, ""));
  const found = tokens.filter((token) => {
    if (token.length < 3 || token.includes("://") || !PATH_CHARS.test(token)) return false;
    const named = token.replace(/\/+$/, "");
    if (named.includes("/")) return EXTENSION.test(named) || exists(named);
    return EXTENSION.test(named) && exists(named);
  });
  return [...new Set(found)];
};
