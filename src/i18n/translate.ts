import { catalogs, type CatalogSource, type MessageKey } from "./catalogs.js";
import { type Lang, SOURCE_LANG } from "./languages.js";

export type Params = Readonly<Record<string, string | number>>;

export type Translate = (key: MessageKey, params?: Params) => string;

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export const interpolate = (template: string, params: Params = {}): string =>
  template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });

export const placeholdersOf = (template: string): readonly string[] =>
  [...new Set(Array.from(template.matchAll(PLACEHOLDER), (match) => match[1] ?? ""))].sort();

export const createTranslator =
  (lang: Lang, source: CatalogSource = catalogs): Translate =>
  (key, params) =>
    interpolate(source[lang][key] ?? source[SOURCE_LANG][key] ?? key, params);
