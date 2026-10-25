import type { JsonObject } from "../core/parsed.js";
import { type Lang, LANGUAGES, SOURCE_LANG } from "./languages.js";
import { placeholdersOf } from "./translate.js";

export const PROBLEM_KINDS = ["missing", "extra", "placeholder", "empty", "not_string"] as const;

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
      return sameList(expected, actual) ? [] : [{ lang, key, kind: "placeholder", expected, actual }];
    });

export const checkCatalogs = (input: RawCatalogs): CatalogReport => {
  const reference = input[SOURCE_LANG];
  const problems = LANGUAGES.flatMap((lang) =>
    lang === SOURCE_LANG
      ? valueProblems(lang, input[lang], reference)
      : [...valueProblems(lang, input[lang], reference), ...parityProblems(lang, input[lang], reference)],
  );
  return { languages: LANGUAGES, keys: Object.keys(reference).length, problems };
};
