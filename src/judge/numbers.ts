export const NUMBER_LOCALES = ["en", "pt", "es"] as const;

export type NumberLocale = (typeof NUMBER_LOCALES)[number];

export type NumberUnit = "percent" | "points" | "currency" | "plain";

export const NUMBER_STATES = ["anchored", "exception", "unit", "magnitude", "unanchored", "input-changed"] as const;

export type NumberState = (typeof NUMBER_STATES)[number];

export interface NumberCheck {
  readonly number: string;
  readonly state: NumberState;
  readonly anchor?: string;
}

export interface FoundNumber {
  readonly raw: string;
  readonly value: number;
  readonly unit: NumberUnit;
  readonly magnitude: number;
}

const MAGNITUDES: readonly (readonly [RegExp, number])[] = [
  [/^(?:thousand|k|mil)$/i, 1e3],
  [/^(?:million|millions|mn|mi|milh(?:ão|ões|ao|oes)|mill(?:ón|ones|on))$/i, 1e6],
  [/^(?:billion|billions|bn|bi|bilh(?:ão|ões|ao|oes)|mil millones)$/i, 1e9],
];

const POINTS = /^(?:percentage points?|p\.?\s?p\.?|pontos percentuais|puntos porcentuales)/i;
const PERCENT = /^(?:%|percent|per cent|por cento|por ciento)/i;
const CURRENCY = /[$€£¥]|R\$|US\$|\b(?:USD|EUR|BRL|GBP)\b/;

const NUMBER =
  /(R\$|US\$|[$€£¥])?\s?(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\s?(?:%|percentage points?|p\.?\s?p\.?|pontos percentuais|puntos porcentuales|percent|per cent|por cento|por ciento|thousand|millions?|billions?|mil millones|milh(?:ão|ões)|bilh(?:ão|ões)|mill(?:ón|ones)|mn|bn|k|mil)\b|%)?/giu;

const parseValue = (digits: string, locale: NumberLocale): number => {
  const decimal = locale === "en" ? "." : ",";
  const group = locale === "en" ? "," : ".";
  const lastDecimal = digits.lastIndexOf(decimal);
  const lastGroup = digits.lastIndexOf(group);
  const groupedOnly = lastDecimal < 0 && /^\d{1,3}(?:[.,\s]\d{3})+$/.test(digits);
  const plain =
    groupedOnly || lastDecimal < lastGroup
      ? digits.replace(/[.,\s]/g, "")
      : digits.split(group).join("").replace(/\s/g, "").replace(decimal, ".");
  return Number(plain);
};

const unitOf = (prefix: string, suffix: string): NumberUnit => {
  if (POINTS.test(suffix)) return "points";
  if (PERCENT.test(suffix)) return "percent";
  return prefix !== "" || CURRENCY.test(suffix) ? "currency" : "plain";
};

const magnitudeOf = (suffix: string): number => MAGNITUDES.find(([pattern]) => pattern.test(suffix.trim()))?.[1] ?? 1;

export const numbersIn = (text: string, locale: NumberLocale = "en"): readonly FoundNumber[] =>
  [...text.matchAll(NUMBER)].map((match) => {
    const [raw, prefix = "", digits = "", suffix = ""] = match;
    return {
      raw: raw.trim(),
      value: parseValue(digits, locale),
      unit: unitOf(prefix, suffix.trim()),
      magnitude: magnitudeOf(suffix),
    };
  });

export type NumberMatch = "same" | "unit" | "magnitude" | "none";

export const compareNumber = (wanted: FoundNumber, found: readonly FoundNumber[]): NumberMatch => {
  const close = (left: number, right: number): boolean => Math.abs(left - right) <= Math.abs(right) * 1e-9;
  const sameDigits = found.filter((item) => close(item.value, wanted.value));
  if (sameDigits.some((item) => item.unit === wanted.unit && item.magnitude === wanted.magnitude)) return "same";
  if (sameDigits.some((item) => item.unit !== wanted.unit && item.unit !== "plain" && wanted.unit !== "plain"))
    return "unit";
  if (sameDigits.some((item) => item.magnitude !== wanted.magnitude)) return "magnitude";
  return sameDigits.some((item) => item.unit === "plain" || wanted.unit === "plain") ? "same" : "none";
};
