import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Git } from "../gate/git.js";
import { showAt } from "./grep.js";
import type { Dependency } from "./types.js";

const MANIFESTS = /(^|\/)(package\.json|requirements\.txt|go\.mod)$/;
const MAX_MANIFESTS = 8;
const PACKAGE_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const REQUIREMENT = /^([A-Za-z0-9_.-]+)\s*(?:[=<>~!]=?\s*([^\s;#]+))?/;
const GO_REQUIRE = /^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+(v[\w.+-]+)/;

const lineOf = (lines: readonly string[], needle: string): number =>
  lines.findIndex((line) => line.includes(needle)) + 1;

const fromPackage = (file: string, text: string): readonly Dependency[] => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return [];
  const lines = text.split("\n");
  return PACKAGE_SECTIONS.flatMap((section) => {
    const block = parsed.value[section];
    if (!isRecord(block)) return [];
    return Object.entries(block).map(([name, version]) => ({
      name,
      version: typeof version === "string" ? version : "",
      at: `${file}:${String(lineOf(lines, `"${name}"`))}`,
    }));
  });
};

const fromLines = (file: string, text: string, pattern: RegExp): readonly Dependency[] =>
  text.split("\n").flatMap((line, index) => {
    const match = pattern.exec(line.trim() === "" || line.trimStart().startsWith("#") ? "" : line);
    if (match?.[1] === undefined) return [];
    return [{ name: match[1], version: match[2] ?? "", at: `${file}:${String(index + 1)}` }];
  });

export const parseManifest = (file: string, text: string): readonly Dependency[] => {
  if (file.endsWith("package.json")) return fromPackage(file, text);
  return fromLines(file, text, file.endsWith("go.mod") ? GO_REQUIRE : REQUIREMENT);
};

export const dependenciesAt = (git: Git, hash: string, files: readonly string[]): readonly Dependency[] =>
  files
    .filter((file) => MANIFESTS.test(file))
    .slice(0, MAX_MANIFESTS)
    .flatMap((file) => {
      const text = showAt(git, hash, file);
      return text === undefined ? [] : parseManifest(file, text);
    });
