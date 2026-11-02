import type { FailureMode } from "./failure-modes.js";
import { FAILURE_MODES_ES } from "./failure-modes-es.js";
import { FAILURE_MODES_PT_BR } from "./failure-modes-pt-BR.js";
import type { Lang } from "./footprint-text.js";

export interface FailureModeText {
  readonly failure: string;
  readonly cause: string;
  readonly mitigation: string;
}

export const FAILURE_MODES_COLUMNS: Readonly<Record<Lang, readonly [string, string, string, string]>> = {
  en: ["Failure", "Cause", "Mitigation", "Proving test"],
  "pt-BR": ["Falha", "Causa", "Mitigação", "Teste que prova"],
  es: ["Fallo", "Causa", "Mitigación", "Prueba que lo demuestra"],
};

const TRANSLATIONS: Readonly<Record<Exclude<Lang, "en">, Readonly<Record<string, FailureModeText>>>> = {
  "pt-BR": FAILURE_MODES_PT_BR,
  es: FAILURE_MODES_ES,
};

export const failureModeText = (mode: FailureMode, lang: Lang): FailureModeText =>
  lang === "en" ? mode : (TRANSLATIONS[lang][mode.failure] ?? mode);

export const missingTranslations = (modes: readonly FailureMode[]): readonly string[] =>
  (["pt-BR", "es"] as const).flatMap((lang) => {
    const known = new Set(modes.map((mode) => mode.failure));
    const missing = modes
      .filter((mode) => TRANSLATIONS[lang][mode.failure] === undefined)
      .map((mode) => `scripts/failure-modes-${lang}.ts has no translation of "${mode.failure}"`);
    const orphans = Object.keys(TRANSLATIONS[lang])
      .filter((failure) => !known.has(failure))
      .map((failure) => `scripts/failure-modes-${lang}.ts translates "${failure}", which is not a failure mode`);
    return [...missing, ...orphans];
  });
