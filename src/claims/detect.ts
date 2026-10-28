import { maskText } from "../mask/mask.js";

const CLAIM_MAX = 160;

const CLAIMS: readonly RegExp[] = [
  /\b(?:done|finished|completed?|implemented|fixed|resolved|shipped|ready (?:for review|to merge|to ship))\b/i,
  /\b(?:all|the) (?:tests|checks|specs) (?:now )?pass(?:es|ed|ing)?\b/i,
  /\b(?:tests|checks|build) (?:now )?pass(?:es|ed|ing)?\b/i,
  /\b(?:it|everything) (?:now )?works\b/i,
  /(?<![\p{L}])(?:pronto|feito|conclu[íi]d[oa]|conclu[íi]|terminei|terminad[oa]|finalizad[oa]|implementad[oa]|corrigid[oa]|resolvid[oa])(?![\p{L}])/iu,
  /(?<![\p{L}])(?:testes|checks?) (?:agora )?(?:passam|passando|passaram)(?![\p{L}])/iu,
  /(?<![\p{L}])(?:est[áa] )?funcionando(?![\p{L}])/iu,
  /(?<![\p{L}])(?:listo|hecho|terminad[oa]|termin[ée]|completad[oa]|implementad[oa]|corregid[oa])(?![\p{L}])/iu,
  /(?<![\p{L}])(?:las )?pruebas (?:ya )?pasan(?![\p{L}])/iu,
];

const NEGATED: readonly RegExp[] = [
  /(?:\b(?:not|never|almost|nearly|once|until|when|after|before|if)|n't)\s+(?:\w+\s+){0,2}$/i,
  /(?:^|[^\p{L}])(?:n[ãa]o|nunca|quase|quando|depois|antes|se|ainda n[ãa]o|no|todav[íi]a no|cuando|despu[ée]s|si)\s+(?:[\p{L}]+\s+){0,2}$/iu,
];

const STILL_FAILING =
  /\b(?:fail(?:s|ing|ed)?|still|broken|blocked)\b|(?<![\p{L}])(?:falh(?:a|am|ando|ou)|ainda|quebrad[oa]|bloquead[oa]|falla(?:n|ndo)?|todav[íi]a|rot[oa])(?![\p{L}])/iu;

const isQuestion = (sentence: string): boolean => /\?\s*$/.test(sentence.trim());

const claimIn = (sentence: string): boolean =>
  !isQuestion(sentence) &&
  !STILL_FAILING.test(sentence) &&
  CLAIMS.some((pattern) => {
    const match = pattern.exec(sentence);
    if (match === null) return false;
    const before = sentence.slice(0, match.index);
    return !NEGATED.some((negation) => negation.test(before));
  });

const sentences = (message: string): readonly string[] =>
  message
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith("```"));

const clip = (text: string): string => {
  const masked = maskText(text);
  return masked.length > CLAIM_MAX ? `${masked.slice(0, CLAIM_MAX)}…` : masked;
};

export const completionClaim = (message: string): string | undefined => {
  const found = sentences(message).find(claimIn);
  return found === undefined ? undefined : clip(found);
};
