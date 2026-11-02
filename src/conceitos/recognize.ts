import { type ConceptId, slugOf } from "./concepts.js";
import { type RecognitionRule, RESEARCH_FIELDS, RULES } from "./recognize-rules.js";

export const RECOGNITION_SOURCES = [
  "import",
  "dependency",
  "api",
  "path",
  "check",
  "cwe",
  "research",
  "model-proposed",
] as const;

export type RecognitionSource = (typeof RECOGNITION_SOURCES)[number];

export interface Recognition {
  readonly concept: ConceptId;
  readonly source: RecognitionSource;
  readonly match: string;
}

export type PackageKeywords = (name: string) => readonly string[];

export interface PackageMap {
  readonly packages: Readonly<Record<string, ConceptId>>;
  readonly keywordsOf: PackageKeywords;
}

export const NO_PACKAGES: PackageMap = { packages: {}, keywordsOf: () => [] };

export interface CodeTouch {
  readonly file: string;
  readonly lines: readonly string[];
}

const MODULE_PATTERNS: readonly RegExp[] = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /^\s*import\s+["']([^"']+)["']/g,
  /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/g,
  /^\s*import\s+([a-z_][\w.]*)\s*$/g,
];

const MANIFEST_LINE = /^\s*"(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)"\s*:\s*"(?:[~^<>=*]|\d|workspace:|npm:|latest)/;
const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][\w.-]*)\s*(?:\[[^\]]*\])?\s*(?:[=<>~!]=|[<>]|$)/;
const NOT_PACKAGES: ReadonlySet<string> = new Set(["version", "node", "npm", "pnpm", "yarn", "bun"]);

export const packageOf = (specifier: string): string | undefined => {
  const bare = specifier.replace(/^node:/, "");
  if (/^[./~]|^@\//.test(bare) || bare === "") return undefined;
  if (bare.startsWith("@")) return bare.split("/").slice(0, 2).join("/");
  const first = bare.split("/")[0] ?? bare;
  return first.includes(".") && !first.endsWith(".js") ? first.split(".")[0] : first;
};

export const importsIn = (lines: readonly string[]): readonly string[] =>
  lines.flatMap((line) =>
    MODULE_PATTERNS.flatMap((pattern) => [...line.matchAll(pattern)].flatMap((match) => match[1] ?? [])),
  );

const baseName = (file: string): string => file.split("/").at(-1) ?? file;

export const dependenciesIn = (file: string, lines: readonly string[]): readonly string[] => {
  const name = baseName(file);
  if (name === "package.json")
    return lines.flatMap((line) => MANIFEST_LINE.exec(line)?.[1] ?? []).filter((item) => !NOT_PACKAGES.has(item));
  if (/^requirements.*\.txt$/.test(name))
    return lines.flatMap((line) => REQUIREMENT_LINE.exec(line)?.[1]?.toLowerCase() ?? []);
  return [];
};

const ruleOfKeywords = (keywords: readonly string[]): RecognitionRule | undefined => {
  const lower = keywords.map((keyword) => keyword.toLowerCase());
  return RULES.find((rule) => rule.keywords?.some((keyword) => lower.includes(keyword)) === true);
};

export const conceptOfPackage = (name: string, map: PackageMap): ConceptId | undefined =>
  map.packages[name] ??
  RULES.find((rule) => rule.packages?.includes(name) === true)?.concept ??
  ruleOfKeywords(map.keywordsOf(name))?.concept;

const packageRecognitions = (
  names: readonly string[],
  source: RecognitionSource,
  map: PackageMap,
): readonly Recognition[] =>
  names.flatMap((name) => {
    const concept = conceptOfPackage(name, map);
    return concept === undefined ? [] : [{ concept, source, match: name }];
  });

const apiRecognitions = (lines: readonly string[]): readonly Recognition[] =>
  RULES.flatMap((rule) => {
    const hit = lines.find((line) => rule.apis?.some((pattern) => pattern.test(line)) === true);
    return hit === undefined
      ? []
      : [{ concept: rule.concept, source: "api" as const, match: hit.trim().slice(0, 120) }];
  });

const pathRecognitions = (file: string, source: RecognitionSource): readonly Recognition[] =>
  RULES.flatMap((rule) =>
    rule.paths?.some((pattern) => pattern.test(file)) === true ? [{ concept: rule.concept, source, match: file }] : [],
  );

export const firstPerConcept = (found: readonly Recognition[]): readonly Recognition[] => {
  const first = new Map<ConceptId, Recognition>();
  for (const item of found) if (!first.has(item.concept)) first.set(item.concept, item);
  return [...first.values()];
};

export const recognizeCode = (touch: CodeTouch, map: PackageMap = NO_PACKAGES): readonly Recognition[] => {
  const imported = importsIn(touch.lines).flatMap((specifier) => packageOf(specifier) ?? []);
  return firstPerConcept([
    ...packageRecognitions(imported, "import", map),
    ...packageRecognitions(dependenciesIn(touch.file, touch.lines), "dependency", map),
    ...apiRecognitions(touch.lines),
    ...pathRecognitions(touch.file, "path"),
  ]);
};

export const recognizeChecks = (runs: readonly string[]): readonly Recognition[] =>
  firstPerConcept(
    runs.flatMap((run) =>
      run
        .split(/\s+/)
        .filter((token) => token.includes("/") || /\.[a-z]{1,4}$/.test(token))
        .flatMap((token) => pathRecognitions(token, "check")),
    ),
  );

export const conceptOfCwe = (cwe: number): ConceptId =>
  RULES.find((rule) => rule.cwe?.includes(cwe) === true)?.concept ?? `security/cwe/cwe-${String(cwe)}`;

export const cweNumberOf = (raw: string | number): number | undefined => {
  const value = typeof raw === "number" ? raw : Number.parseInt(raw.replace(/^cwe-?/i, ""), 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

export const recognizeFindings = (cwes: readonly (string | number)[]): readonly Recognition[] =>
  firstPerConcept(
    cwes.flatMap((raw) => {
      const cwe = cweNumberOf(raw);
      return cwe === undefined
        ? []
        : [{ concept: conceptOfCwe(cwe), source: "cwe" as const, match: `CWE-${String(cwe)}` }];
    }),
  );

export interface ResearchTouch {
  readonly slug: string;
  readonly urls: readonly string[];
}

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

export const fieldOfUrl = (url: string): string | undefined => {
  const host = hostOf(url);
  return host === undefined
    ? undefined
    : RESEARCH_FIELDS.find((item) => item.hosts.some((pattern) => pattern.test(host)))?.field;
};

export const recognizeResearch = (touch: ResearchTouch): readonly Recognition[] => {
  const topic = slugOf(touch.slug);
  if (topic === "") return [];
  return firstPerConcept(
    touch.urls.flatMap((url) => {
      const field = fieldOfUrl(url);
      return field === undefined
        ? []
        : [{ concept: `research/${field}/${topic}`, source: "research" as const, match: url }];
    }),
  );
};
