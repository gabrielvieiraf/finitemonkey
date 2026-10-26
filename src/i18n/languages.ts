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

export const CLAUDE_LANGUAGE: Readonly<Record<Lang, string>> = {
  en: "english",
  "pt-BR": "brazilian portuguese",
  es: "spanish",
};

export const claudeLanguageToLang = (raw: string | undefined): Lang | undefined => {
  if (raw === undefined) return undefined;
  const name = raw.trim().toLowerCase();
  if (name.includes("portug")) return "pt-BR";
  if (/^(spanish|espa(ñ|n)ol|castellano)\b/.test(name)) return "es";
  if (/^(english|ingl(ê|e)s)\b/.test(name)) return "en";
  return normalizeLang(name);
};

export const LOCALE_ENV_ORDER = ["LC_ALL", "LC_MESSAGES", "LANG"] as const;

export type LangSource =
  | "flag"
  | "FINITEMONKEY_LANG"
  | "config"
  | "claude-settings"
  | (typeof LOCALE_ENV_ORDER)[number]
  | "system"
  | "default";

export interface DetectedLang {
  readonly lang: Lang;
  readonly source: LangSource;
}

export interface LangSettings {
  readonly config?: string | undefined;
  readonly claude?: string | undefined;
  readonly system?: string | undefined;
  readonly reviewedOnly?: boolean;
}

export const detectLang = (flag: string | undefined, env: Env, settings: LangSettings = {}): DetectedLang => {
  const candidates: readonly (readonly [LangSource, Lang | undefined])[] = [
    ["flag", normalizeLang(flag)],
    ["FINITEMONKEY_LANG", normalizeLang(env["FINITEMONKEY_LANG"])],
    ["config", normalizeLang(settings.config)],
    ["claude-settings", claudeLanguageToLang(settings.claude)],
    ...LOCALE_ENV_ORDER.map((name) => [name, normalizeLang(env[name])] as const),
    ["system", normalizeLang(settings.system)],
  ];
  for (const [source, lang] of candidates) if (lang !== undefined) return { lang, source };
  return { lang: SOURCE_LANG, source: "default" };
};
