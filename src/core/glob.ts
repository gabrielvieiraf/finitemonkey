import { toPosixPath } from "../core/posix-path.js";
const escape = (char: string): string => (/[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char);

export const globToRegExp = (glob: string): RegExp => {
  const pattern = glob.replace(/^\.\//, "");
  let out = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*" && pattern[index + 1] === "*") {
      const slash = pattern[index + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += escape(char);
  }
  return new RegExp(`^${out}${pattern.endsWith("/") ? ".*" : ""}$`);
};

export const matchesAny = (path: string, globs: readonly string[]): boolean => {
  const normalized = toPosixPath(path);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
};
