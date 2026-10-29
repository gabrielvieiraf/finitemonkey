const NUMBER = /\p{N}/u;
const MONTHS = new RegExp(
  `\\b(?:${[
    "january|february|march|april|june|july|august|september|october|november|december",
    "janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro",
    "enero|febrero|marzo|mayo|junio|julio|septiembre|setiembre|octubre|noviembre|diciembre",
  ].join("|")})\\b`,
  "iu",
);
const CITATION = /\b10\.\d{4,9}\/\S+|https?:\/\/\S+|\[\d+\]|\(\p{Lu}[\p{L}-]+(?: et al\.?)?,? \d{4}\)/u;
const CAUSAL =
  /\b(?:because|due to|caused?|causes|leads? to|results? in|as a result|therefore|thus|hence|so that|porque|devido a|causa|leva a|resulta em|portanto|por isso|debido a|provoca|conduce a|por lo tanto|por eso)\b/i;
const ACRONYM = /\b\p{Lu}{2,}\b/u;
const CAPITAL = /^\p{Lu}\p{Ll}+/u;

const properNoun = (sentence: string): boolean => {
  if (ACRONYM.test(sentence)) return true;
  const words = sentence.split(/\s+/).slice(1);
  return words.some((word) => CAPITAL.test(word.replace(/^["“'([]+/, "")));
};

export const SCOPE_REASONS = ["number", "date", "citation", "causal", "proper-noun"] as const;

export type ScopeReason = (typeof SCOPE_REASONS)[number];

export const scopeOf = (sentence: string): ScopeReason | undefined => {
  if (CITATION.test(sentence)) return "citation";
  if (NUMBER.test(sentence)) return "number";
  if (MONTHS.test(sentence)) return "date";
  if (CAUSAL.test(sentence)) return "causal";
  return properNoun(sentence) ? "proper-noun" : undefined;
};

export const inScope = (sentence: string): boolean => scopeOf(sentence) !== undefined;
