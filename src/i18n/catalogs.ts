import en from "./en.json" with { type: "json" };
import es from "./es.json" with { type: "json" };
import type { Lang } from "./languages.js";
import ptBR from "./pt-BR.json" with { type: "json" };

export type MessageKey = keyof typeof en;

export type Catalog = Readonly<Record<MessageKey, string>>;

type ExactCatalog<T> = Catalog & Readonly<Record<Exclude<keyof T, MessageKey>, never>>;

const exact = <T extends ExactCatalog<T>>(catalog: T): Catalog => catalog;

export const catalogs = {
  en: exact(en),
  "pt-BR": exact(ptBR),
  es: exact(es),
} as const satisfies Readonly<Record<Lang, Catalog>>;

export type CatalogSource = Readonly<Record<Lang, Readonly<Partial<Record<MessageKey, string>>>>>;
