import { catalogs, type CatalogSource, type MessageKey } from "./catalogs.js";
import { type Lang, SOURCE_LANG } from "./languages.js";
import { argumentsOf, formatMessage, type Params } from "./message.js";

export type { Params } from "./message.js";

export type Translate = (key: MessageKey, params?: Params) => string;

export const interpolate = (template: string, params: Params = {}, lang: Lang = SOURCE_LANG): string =>
  formatMessage(template, params, lang);

export const placeholdersOf = (template: string): readonly string[] => argumentsOf(template);

export interface TranslatorOptions {
  readonly reviewed?: ReadonlySet<string> | undefined;
}

export const createTranslator =
  (lang: Lang, source: CatalogSource = catalogs, options: TranslatorOptions = {}): Translate =>
  (key, params) => {
    const usable = lang === SOURCE_LANG || options.reviewed === undefined || options.reviewed.has(key);
    const own = usable ? source[lang][key] : undefined;
    return own === undefined
      ? interpolate(source[SOURCE_LANG][key] ?? key, params, SOURCE_LANG)
      : interpolate(own, params, lang);
  };
