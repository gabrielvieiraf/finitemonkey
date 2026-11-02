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

const MAVEN_DEPENDENCY = /<dependency>([\s\S]*?)<\/dependency>/g;
const GRADLE_DEPENDENCY =
  /^\s*(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|compile|testCompile)\s*\(?\s*["']([\w.-]+):([\w.-]+)(?::([^"']+))?["']/;

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

const tag = (block: string, name: string): string =>
  new RegExp(`<${name}>\\s*([^<\\s]+)\\s*</${name}>`).exec(block)?.[1] ?? "";

const fromMaven = (file: string, text: string): readonly Dependency[] =>
  [...text.matchAll(MAVEN_DEPENDENCY)].flatMap((match) => {
    const block = match[1] ?? "";
    const group = tag(block, "groupId");
    const artifact = tag(block, "artifactId");
    return group === "" || artifact === ""
      ? []
      : [
          {
            name: `${group}:${artifact}`,
            version: tag(block, "version"),
            at: `${file}:${String(lineAt(text, match.index))}`,
          },
        ];
  });

const fromGradle = (file: string, text: string): readonly Dependency[] =>
  text.split("\n").flatMap((line, index) => {
    const match = GRADLE_DEPENDENCY.exec(line);
    return match?.[1] === undefined || match[2] === undefined
      ? []
      : [{ name: `${match[1]}:${match[2]}`, version: match[3] ?? "", at: `${file}:${String(index + 1)}` }];
  });

export const parseManifest = (file: string, text: string): readonly Dependency[] => {
  if (file.endsWith("package.json")) return fromPackage(file, text);
  if (file.endsWith("pom.xml")) return fromMaven(file, text);
  if (/build\.gradle(\.kts)?$/.test(file)) return fromGradle(file, text);
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
