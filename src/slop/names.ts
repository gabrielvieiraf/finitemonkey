import type { SlopDetector } from "./types.js";

const IMPROVEMENT_SUFFIX = new Set([
  "enhanced",
  "improved",
  "better",
  "optimized",
  "fixed",
  "final",
  "updated",
  "refactored",
  "copy",
  "backup",
  "temp",
]);
const COPY_KINDS = new Set(["deep", "shallow", "safe", "make", "to", "structured"]);
const IMPROVEMENT_PREFIX = new Set(["enhanced", "improved", "better", "optimized", "refactored"]);
const VERSION_SUFFIX = new Set(["new", "old", "legacy"]);
const GENERIC = new Set([
  "data",
  "info",
  "manager",
  "helper",
  "helpers",
  "util",
  "utils",
  "utility",
  "utilities",
  "misc",
  "stuff",
  "thing",
  "things",
  "obj",
  "object",
  "handler",
  "processor",
  "temp",
  "tmp",
  "foo",
  "bar",
]);

export const wordsOf = (name: string): readonly string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .split(/[\s_\-$]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());

const isVersion = (word: string): boolean => /^v\d+$/.test(word);

const joinVersion = (words: readonly string[]): readonly string[] =>
  words.flatMap((word, index) => {
    const previous = words[index - 1];
    if (/^\d+$/.test(word) && previous === "v") return [];
    return word === "v" && /^\d+$/.test(words[index + 1] ?? "") ? [`v${words[index + 1] ?? ""}`] : [word];
  });

export const nameDetector = (name: string): SlopDetector | undefined => {
  const words = joinVersion(wordsOf(name));
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  const copying = last === "copy" && COPY_KINDS.has(words[words.length - 2] ?? "");
  if (words.length > 1 && !copying && (IMPROVEMENT_SUFFIX.has(last) || IMPROVEMENT_PREFIX.has(first))) {
    return "improvement_name";
  }
  if (words.length > 1 && (VERSION_SUFFIX.has(last) || isVersion(last) || first === "legacy")) return "version_name";
  if (words.length > 0 && words.every((word) => GENERIC.has(word))) return "generic_name";
  return undefined;
};

const SIBLING_SUFFIX =
  /(?:[-_.](?:v\d+|new|old|copy|backup|bak|temp|tmp|final|fixed|updated|refactored|enhanced|improved|better|optimized|legacy|\d+)|(?<=[a-z0-9])(?:V\d+|New|Old|Copy|Backup|Temp|Final|Fixed|Updated|Refactored|Enhanced|Improved|Better|Optimized|Legacy))$/;

export const siblingStem = (stem: string): string | undefined => {
  let current = stem;
  for (let round = 0; round < 3; round += 1) {
    const next = current.replace(SIBLING_SUFFIX, "");
    if (next === current || next === "") break;
    current = next;
  }
  return current === stem ? undefined : current;
};
