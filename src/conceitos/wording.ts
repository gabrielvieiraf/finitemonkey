export const DESCRIBED_PREFIXES = [
  "xray.",
  "conceitos.state.",
  "conceitos.evidence.",
  "probe.",
  "trajectory.",
] as const;

export interface WordingRule {
  readonly pattern: RegExp;
  readonly why: string;
}

export const FORBIDDEN: readonly WordingRule[] = [
  { pattern: /\byou(?:'re| are)\b/i, why: "describes the person instead of the task or the record" },
  {
    pattern: /\byou (?:don't|do not|can't|cannot|lack|need to learn|should learn|failed to understand)\b/i,
    why: "judges the person",
  },
  { pattern: /\byour (?:level|skill|ability|knowledge|competence|understanding)\b/i, why: "rates the person" },
  {
    pattern: /\b(?:beginner|novice|junior|expert|weak|strong|smart|competent|incompetent)\b/i,
    why: "labels the person",
  },
  { pattern: /\bvoc[eê] (?:é|não sabe|não entende|precisa aprender|deveria saber)\b/i, why: "julga a pessoa" },
  { pattern: /\b(?:seu|sua) (?:nível|habilidade|conhecimento|competência|entendimento)\b/i, why: "avalia a pessoa" },
  { pattern: /\b(?:iniciante|novato|especialista|fraco|forte|inteligente)\b/i, why: "rotula a pessoa" },
  { pattern: /\b(?:eres|no sabes|no entiendes|necesitas aprender)\b/i, why: "juzga a la persona" },
  { pattern: /\b(?:tu|su) (?:nivel|habilidad|conocimiento|competencia)\b/i, why: "evalúa a la persona" },
  { pattern: /\b(?:principiante|novato|experto|débil|inteligente)\b/i, why: "etiqueta a la persona" },
];

export const ALLOWED_EXAMPLES: readonly string[] = [
  "no own prediction, change or repair on record",
  "written by the agent",
  "covered by a criterion",
  "you predicted 3 of 4",
  "this block opens a transaction",
];

export const wordingProblems = (text: string): readonly string[] =>
  FORBIDDEN.filter((rule) => rule.pattern.test(text)).map((rule) => rule.why);

export const ABILITY: readonly RegExp[] = [
  /\byour (?:level|skill|ability|knowledge|competence|understanding)\b/i,
  /\byou (?:don't|do not|can't|cannot|lack|need to learn|should learn) (?:know|understand)/i,
  /\bvoc[eê] (?:é|não sabe|não entende|precisa aprender)\b/i,
  /\b(?:seu|sua) (?:nível|habilidade|conhecimento|competência|entendimento)\b/i,
  /\btu (?:nivel|habilidad|conocimiento|competencia)\b/i,
  /\bno sabes\b|\bno entiendes\b/i,
];
