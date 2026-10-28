import type { PersonRequest } from "./log.js";

export const AUDIT_STATES = ["contradicted", "superseded", "in_master", "only_report", "lost"] as const;

export type AuditState = (typeof AUDIT_STATES)[number];

export type AuditKind = "number" | "correction" | "decision" | "request";

export interface PlanDoc {
  readonly file: string;
  readonly text: string;
  readonly master: boolean;
}

export interface AuditItem {
  readonly at: string;
  readonly text: string;
  readonly kind: AuditKind;
  readonly state: AuditState;
  readonly where?: string;
}

const STOP = new Set(
  "that this with from have will what when where which there their they them then than into also just only some more much very your yours mine para isso essa esse esta este como mais muito pelo pela porque quando onde sobre entre depois antes tambem ainda aqui agora esto esta este como para pero cuando donde sobre entre despues antes tambien todavia aqui ahora should would could".split(
    " ",
  ),
);
const TRIGGER =
  /\b(always|never|must|should|need|want|use|add|remove|keep|make|decide[ds]?|instead|wrong|actually|sempre|nunca|deve|precisa|quero|usa|usar|adiciona|remove|mant[eé]m|decid[io]|em vez|errado|na verdade|siempre|debe|necesita|quiero|agrega|quita|mantiene|en vez)\b/i;
const CORRECTION = /\b(no,|not |wrong|instead|actually|n[aã]o |errado|na verdade|em vez|en vez|no es)\b/i;
const DECISION = /\b(decide[ds]?|let's go with|go with|vamos com|decidi|decidimos|vamos con)\b/i;
const NUMBER = /\d+(?:[.,]\d+)?/g;

const normalize = (text: string): string => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export const wordsOf = (text: string): ReadonlySet<string> =>
  new Set(
    normalize(text)
      .match(/[a-z]{4,}/g)
      ?.filter((word) => !STOP.has(word)) ?? [],
  );

const numbersOf = (text: string): readonly string[] =>
  (text.match(NUMBER) ?? []).map((value) => value.replace(",", "."));

const coverage = (words: ReadonlySet<string>, target: ReadonlySet<string>): number =>
  words.size === 0 ? 0 : [...words].filter((word) => target.has(word)).length / words.size;

const kindOf = (sentence: string): AuditKind => {
  if (numbersOf(sentence).length > 0) return "number";
  if (CORRECTION.test(sentence)) return "correction";
  return DECISION.test(sentence) ? "decision" : "request";
};

export const statementsOf = (request: PersonRequest): readonly { at: string; text: string; kind: AuditKind }[] =>
  request.text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        wordsOf(sentence).size >= 3 && (TRIGGER.test(normalize(sentence)) || numbersOf(sentence).length > 0),
    )
    .map((text) => ({ at: request.at, text, kind: kindOf(text) }));

const MATCH = 0.6;
const LINE_MATCH = 0.5;

const contradiction = (text: string, docs: readonly PlanDoc[]): string | undefined => {
  const numbers = numbersOf(text);
  if (numbers.length === 0) return undefined;
  const words = wordsOf(text);
  for (const doc of docs) {
    const lines = doc.text.split("\n");
    const index = lines.findIndex((line) => {
      const theirs = numbersOf(line);
      return (
        theirs.length > 0 &&
        coverage(words, wordsOf(line)) >= LINE_MATCH &&
        !theirs.some((value) => numbers.includes(value))
      );
    });
    if (index !== -1) return `${doc.file}:${String(index + 1)}`;
  }
  return undefined;
};

const placeOf = (text: string, docs: readonly PlanDoc[]): Pick<AuditItem, "state" | "where"> => {
  const words = wordsOf(text);
  const master = docs.find((doc) => doc.master && coverage(words, wordsOf(doc.text)) >= MATCH);
  if (master !== undefined) return { state: "in_master", where: master.file };
  const report = docs.find((doc) => !doc.master && coverage(words, wordsOf(doc.text)) >= MATCH);
  return report === undefined ? { state: "lost" } : { state: "only_report", where: report.file };
};

export const classify = (requests: readonly PersonRequest[], docs: readonly PlanDoc[]): readonly AuditItem[] => {
  const statements = requests.flatMap(statementsOf);
  return statements.map((statement, index) => {
    const contradicted = contradiction(statement.text, docs);
    if (contradicted !== undefined) return { ...statement, state: "contradicted", where: contradicted };
    const words = wordsOf(statement.text);
    const later = statements.slice(index + 1).find((next) => coverage(words, wordsOf(next.text)) >= MATCH);
    if (later !== undefined) return { ...statement, state: "superseded", where: later.at };
    return { ...statement, ...placeOf(statement.text, docs) };
  });
};
