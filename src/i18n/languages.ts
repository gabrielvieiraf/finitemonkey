import type { Env } from "../core/context.js";

export const LANGUAGES = ["en", "pt-BR", "es"] as const;

export type Lang = (typeof LANGUAGES)[number];

export const SOURCE_LANG = "en" satisfies Lang;

export const normalizeLang = (raw: string | undefined): Lang | undefined => {
  if (raw === undefined) return undefined;
  const base = (raw.trim().split(/[.@:]/)[0] ?? "").replace(/_/g, "-").toLowerCase();
  if (base === "pt" || base.startsWith("pt-")) return "pt-BR";
  if (base === "es" || base.startsWith("es-")) return "es";
  if (base === "en" || base.startsWith("en-")) return "en";
  return undefined;
};

export const LANG_ENV_ORDER = ["FINITEMONKEY_LANG", "LC_ALL", "LC_MESSAGES", "LANG"] as const;

export type LangSource = "flag" | (typeof LANG_ENV_ORDER)[number] | "default";

export interface DetectedLang {
  readonly lang: Lang;
  readonly source: LangSource;
}

export const detectLang = (flag: string | undefined, env: Env): DetectedLang => {
  const fromFlag = normalizeLang(flag);
  if (fromFlag) return { lang: fromFlag, source: "flag" };
  for (const name of LANG_ENV_ORDER) {
    const lang = normalizeLang(env[name]);
    if (lang) return { lang, source: name };
  }
  return { lang: SOURCE_LANG, source: "default" };
};
