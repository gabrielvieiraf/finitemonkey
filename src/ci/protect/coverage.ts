import { CODEOWNERS_PLACES, ownedPaths } from "../../generate/github/codeowners.js";

export interface CodeownersCoverage {
  readonly file: string | undefined;
  readonly missing: readonly string[];
}

const bare = (pattern: string): string => pattern.replace(/^\//, "").replace(/\/\*\*$|\/\*$|\/$/, "");

const covers = (pattern: string, path: string): boolean => {
  const owned = bare(pattern);
  const wanted = bare(path);
  return pattern === "*" || owned === wanted || wanted.startsWith(`${owned}/`);
};

const patternsOf = (text: string): readonly string[] =>
  text.split("\n").flatMap((raw) => {
    const line = raw.trim();
    const [pattern, ...owners] = line.split(/\s+/);
    return line === "" || line.startsWith("#") || pattern === undefined || owners.length === 0 ? [] : [pattern];
  });

export const codeownersCoverage = (
  read: (path: string) => string | undefined,
  dirs: (candidates: readonly string[]) => readonly string[],
): CodeownersCoverage => {
  const file = CODEOWNERS_PLACES.find((place) => read(place) !== undefined);
  const patterns = file === undefined ? [] : patternsOf(read(file) ?? "");
  const required = [...ownedPaths(dirs), `/${file ?? CODEOWNERS_PLACES[0]}`];
  return { file, missing: required.filter((path) => !patterns.some((pattern) => covers(pattern, path))) };
};
