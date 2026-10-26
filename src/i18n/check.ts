import type { JsonObject } from "../core/parsed.js";
import { type Lang, LANGUAGES, SOURCE_LANG } from "./languages.js";
import { choicesOf, requiredPluralBranches } from "./message.js";
import { placeholdersOf } from "./translate.js";

export const PROBLEM_KINDS = [
  "missing",
  "extra",
  "placeholder",
  "plural",
  "empty",
  "not_string",
  "status",
  "release_hint",
] as const;

export const REVIEW_STATUSES = ["machine", "reviewed"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type ProblemKind = (typeof PROBLEM_KINDS)[number];

export interface CatalogProblem {
  readonly lang: Lang;
  readonly key: string;
  readonly kind: ProblemKind;
  readonly expected?: readonly string[];
  readonly actual?: readonly string[];
}

export interface CatalogReport {
  readonly languages: readonly Lang[];
  readonly keys: number;
  readonly problems: readonly CatalogProblem[];
}

export type RawCatalogs = Readonly<Record<Lang, JsonObject>>;

export type RawReview = Readonly<Partial<Record<Lang, JsonObject>>>;

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const valueProblems = (lang: Lang, catalog: JsonObject, reference: JsonObject): CatalogProblem[] =>
  Object.keys(catalog)
    .sort()
    .flatMap((key): CatalogProblem[] => {
      const value = catalog[key];
      if (typeof value !== "string") return [{ lang, key, kind: "not_string" }];
      const problems: CatalogProblem[] = [];
      if (value.trim() === "") problems.push({ lang, key, kind: "empty" });
      if (!(key in reference)) problems.push({ lang, key, kind: "extra" });
      return problems;
    });

const pluralProblems = (lang: Lang, key: string, value: string, source: string): CatalogProblem[] => {
  const own = choicesOf(value);
  return choicesOf(source).flatMap((choice): CatalogProblem[] => {
    const found = own.find((item) => item.name === choice.name && item.kind === choice.kind);
    const expected = choice.kind === "plural" ? requiredPluralBranches(lang) : choice.branches;
    const actual = found?.branches ?? [];
    const missingBranch = expected.some((branch) => !actual.includes(branch));
    return missingBranch ? [{ lang, key, kind: "plural", expected, actual }] : [];
  });
};

const parityProblems = (lang: Lang, catalog: JsonObject, reference: JsonObject): CatalogProblem[] =>
  Object.keys(reference)
    .sort()
    .flatMap((key): CatalogProblem[] => {
      const value = catalog[key];
      const source = reference[key];
      if (value === undefined) return [{ lang, key, kind: "missing" }];
      if (typeof value !== "string" || typeof source !== "string") return [];
      const expected = placeholdersOf(source);
      const actual = placeholdersOf(value);
      const placeholders: CatalogProblem[] = sameList(expected, actual)
        ? []
        : [{ lang, key, kind: "placeholder", expected, actual }];
      return [...placeholders, ...pluralProblems(lang, key, value, source)];
    });

const isStatus = (value: unknown): value is ReviewStatus => REVIEW_STATUSES.some((status) => status === value);

const statusProblems = (lang: Lang, catalog: JsonObject, review: JsonObject): CatalogProblem[] => [
  ...Object.keys(catalog)
    .sort()
    .filter((key) => !isStatus(review[key]))
    .map((key): CatalogProblem => ({ lang, key, kind: "status", expected: [...REVIEW_STATUSES] })),
  ...Object.keys(review)
    .sort()
    .filter((key) => !(key in catalog))
    .map((key): CatalogProblem => ({ lang, key, kind: "extra" })),
];

const sourceProblems = (catalog: JsonObject): CatalogProblem[] =>
  Object.keys(catalog)
    .sort()
    .flatMap((key) => {
      const value = catalog[key];
      return typeof value === "string" ? pluralProblems(SOURCE_LANG, key, value, value) : [];
    });

export const MODEL_FACING = /\.(claim|requires|not)$|^gate\.tests\.|^reason\.label\./;

const RELEASE_HINTS: readonly RegExp[] = [
  /--yes\b/,
  /\b(finitemonkey|fm)\b[^\n]{0,20}\b(allow|off|on|trust|approve)\b/i,
  /\ballow\s+(bypass|tests|self|config)\b/i,
  /\bFINITEMONKEY_[A-Z_]+/,
  /\b[A-Z][A-Z0-9_]{2,}=/,
];

export const releaseHints = (text: string): readonly string[] =>
  RELEASE_HINTS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match === null ? [] : [match[0]];
  });

const hintProblems = (lang: Lang, catalog: JsonObject): CatalogProblem[] =>
  Object.keys(catalog)
    .filter((key) => MODEL_FACING.test(key))
    .sort()
    .flatMap((key): CatalogProblem[] => {
      const value = catalog[key];
      const found = typeof value === "string" ? releaseHints(value) : [];
      return found.length === 0 ? [] : [{ lang, key, kind: "release_hint", actual: found }];
    });

export const checkCatalogs = (input: RawCatalogs, review?: RawReview): CatalogReport => {
  const reference = input[SOURCE_LANG];
  const problems = LANGUAGES.flatMap((lang) => {
    if (lang === SOURCE_LANG) {
      return [
        ...valueProblems(lang, input[lang], reference),
        ...sourceProblems(reference),
        ...hintProblems(lang, reference),
      ];
    }
    const statuses = review?.[lang];
    return [
      ...valueProblems(lang, input[lang], reference),
      ...parityProblems(lang, input[lang], reference),
      ...hintProblems(lang, input[lang]),
      ...(review === undefined ? [] : statusProblems(lang, input[lang], statuses ?? {})),
    ];
  });
  return { languages: LANGUAGES, keys: Object.keys(reference).length, problems };
};
