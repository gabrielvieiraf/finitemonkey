import type { Catalog } from "../i18n/catalogs.js";

export const JUDGE_PREFIXES = ["judge.", "gate.judge.", "command.judge_"] as const;

const PERSON_LABELS = [
  /\byou(?:'re| are)\b/i,
  /\byour (?:level|skill|knowledge|ability|expertise)\b/i,
  /\b(?:beginner|novice|expert|newbie|junior|senior|incompetent|ignorant|lazy)\b/i,
  /\bvocê (?:é|não sabe)\b/i,
  /\bseu (?:nível|conhecimento)\b/i,
  /\b(?:iniciante|leigo|especialista|novato)\b/i,
  /\b(?:usted|tú) (?:es|eres|no sabe)\b/i,
  /\bsu (?:nivel|conocimiento)\b/i,
  /\b(?:principiante|experto|novato|lego)\b/i,
];

export const describesPerson = (text: string): boolean => PERSON_LABELS.some((pattern) => pattern.test(text));

export const personWording = (catalog: Catalog): readonly string[] =>
  Object.entries(catalog)
    .filter(([key]) => JUDGE_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .filter(([, text]) => describesPerson(text))
    .map(([key]) => key);
