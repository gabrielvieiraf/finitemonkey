import type { ProseRuleId } from "./types.js";

export interface PhraseRule {
  readonly rule: ProseRuleId;
  readonly weight: number;
  readonly patterns: readonly RegExp[];
}

export const lazy = <T>(build: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= build());
};

const bounded = (alternatives: readonly string[], flags: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, flags);

export const phrases = (...alternatives: readonly string[]): RegExp => bounded(alternatives, "iu");

export const casedPhrases = (...alternatives: readonly string[]): RegExp => bounded(alternatives, "u");

const OPENER = (): readonly RegExp[] => [
  phrases("you know the (?:routine|drill)", "we've all been there", "we all know the feeling", "sound familiar\\?"),
  phrases(
    "(?:você )?(?:já )?conhece (?:a rotina|o roteiro|o esquema)",
    "todo mundo já passou por isso",
    "soa familiar\\?",
  ),
  phrases(
    "(?:ya )?conoces (?:la rutina|el guion|el procedimiento)",
    "todos hemos pasado por (?:eso|esto)",
    "¿te suena\\?",
  ),
];

const REASSURANCE = (): readonly RegExp[] => [
  phrases(
    "(?:is|it's|that's|that is) not a character flaw",
    "nobody(?:'s| is)(?: here)? (?:lazy|to blame)",
    "no one(?:'s| is)(?: here)? (?:lazy|to blame)",
    "it(?:'s| is) not your fault",
    "you(?:'re| are) not alone",
  ),
  phrases(
    "não é (?:um )?defeito de caráter",
    "ninguém (?:aqui )?é preguiçoso",
    "a culpa não é sua",
    "não é culpa sua",
    "você não está sozinh[oa]",
  ),
  phrases("no es un defecto de carácter", "(?:aquí )?nadie es vago", "no es (?:tu|su) culpa", "no estás sol[oa]"),
];

const SLOGAN = (): readonly RegExp[] => [
  phrases("and that changes everything", "that's the whole point", "simple as that", "it's that simple"),
  phrases("e isso muda tudo", "simples assim", "é simples assim", "e ponto final"),
  phrases("y eso lo cambia todo", "así de simple", "así de fácil", "y punto"),
];

const ABSTRACT = (): readonly RegExp[] => [
  phrases(
    "the (?:pace|speed|rhythm|nature|reality) of (?:the )?(?:work|modern work|software|development)",
    "the reality is",
    "in today's (?:fast-paced|digital|modern) world",
  ),
  phrases(
    "(?:o|a) (?:ritmo|velocidade|natureza|realidade) do (?:trabalho|desenvolvimento)",
    "a realidade é que",
    "no mundo (?:atual|de hoje)",
  ),
  phrases(
    "(?:el|la) (?:ritmo|velocidad|naturaleza|realidad) del (?:trabajo|desarrollo)",
    "la realidad es que",
    "en el mundo (?:actual|de hoy)",
  ),
];

const CRUTCH = (): readonly RegExp[] => [
  phrases(
    "delv(?:e|es|ed|ing)",
    "seamless(?:ly)?",
    "robust(?:ness)?",
    "leverag(?:e|es|ed|ing)",
    "game[- ]chang(?:er|ers|ing)",
    "it(?:'s| is) worth noting",
    "cutting[- ]edge",
    "unlock the (?:full )?(?:power|potential)",
    "supercharg(?:e|ed|es)",
    "effortless(?:ly)?",
    "in conclusion",
    "at the end of the day",
    "navigate the (?:complexities|landscape)",
  ),
  phrases(
    "vale (?:ressaltar|destacar|lembrar que)",
    "cabe (?:destacar|ressaltar)",
    "é importante (?:ressaltar|destacar|notar)",
    "em (?:resumo|suma)",
    "robust(?:o|a|os|as|ez)",
    "alavanc(?:ar|a|ando|ado)",
    "divisor de águas",
    "sem esforço",
    "potencializ(?:ar|a|ando)",
    "de forma fluida",
  ),
  phrases(
    "en (?:resumen|conclusión)",
    "cabe (?:destacar|señalar|mencionar)",
    "vale la pena (?:destacar|mencionar|señalar)",
    "es importante (?:destacar|señalar)",
    "robust(?:o|a|os|as|ez)",
    "apalanc(?:ar|a|ando)",
    "sin fisuras",
    "sin esfuerzo",
    "cambia las reglas del juego",
  ),
];

export const phraseRules = lazy((): readonly PhraseRule[] => [
  { rule: "opener-routine", weight: 3, patterns: OPENER() },
  { rule: "reassurance", weight: 3, patterns: REASSURANCE() },
  { rule: "slogan-closer", weight: 2, patterns: SLOGAN() },
  { rule: "abstract-noun", weight: 2, patterns: ABSTRACT() },
  { rule: "crutch-word", weight: 3, patterns: CRUTCH() },
]);

export const IMPERATIVE_VERBS: ReadonlySet<string> = new Set([
  "type",
  "ship",
  "work",
  "write",
  "let",
  "build",
  "go",
  "stop",
  "start",
  "keep",
  "make",
  "focus",
  "forget",
  "trust",
  "code",
  "digite",
  "trabalhe",
  "produza",
  "deixe",
  "escreva",
  "faça",
  "pare",
  "comece",
  "entregue",
  "esqueça",
  "confie",
  "foque",
  "programe",
  "escribe",
  "teclea",
  "trabaja",
  "produce",
  "deja",
  "haz",
  "empieza",
  "olvida",
  "confía",
  "programa",
  "entrega",
]);

export const STRUCTURE_WEIGHTS = {
  triplet: 1,
  imperative: 1,
  closer: 1,
  antithesis: 1,
  antithesisPair: 2,
  heading: 1,
  emoji: 1,
  dash: 1,
  dashSeries: 2,
} as const;
