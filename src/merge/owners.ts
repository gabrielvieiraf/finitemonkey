import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";

const CODEOWNERS_FILES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"] as const;

const ownerPattern = (pattern: string): string => {
  const anchored = pattern.startsWith("/") ? pattern.slice(1) : pattern.includes("/") ? pattern : `**/${pattern}`;
  return anchored.endsWith("/") ? `${anchored}**` : anchored;
};

export const codeOwners = (runtime: Runtime, root: AbsolutePath): ((path: string) => readonly string[]) => {
  const text = CODEOWNERS_FILES.map((file) => runtime.readText(toAbsolutePath(file, root))).find((read) => read.ok);
  const rules = (text?.ok === true ? text.value : "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [pattern = "", ...owners] = line.split(/\s+/);
      return { pattern: ownerPattern(pattern), owners };
    });
  return (path) =>
    [...rules].reverse().find((rule) => matchesAny(path, [rule.pattern, `${rule.pattern}/**`]))?.owners ?? [];
};
