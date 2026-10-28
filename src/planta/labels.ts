export const LABELS = ["saas", "production", "done"] as const;

export type Label = (typeof LABELS)[number];

export interface LabelHit {
  readonly label: Label;
  readonly phrase: string;
}

const READY = String.raw`(?:ready|done|finished|complete|completed|live|launched|pronto|pronta|prontos|conclu[ií]d[oa]|finalizad[oa]|terminad[oa]|no ar|listo|lista|terminado|completado|acabado|funcionando)`;
const PRODUCT = String.raw`(?:saas|app|application|aplicativo|aplicaci[oó]n|product|produto|producto|platform|plataforma|system|sistema|site|website|landing(?: page)?|p[aá]gina|project|projeto|proyecto)`;
const GAP = String.raw`(?:\s+\S+){0,5}?\s+`;

const PATTERNS: Readonly<Record<Label, readonly RegExp[]>> = {
  saas: [new RegExp(String.raw`\bsaas\b${GAP}${READY}\b`, "i"), new RegExp(String.raw`\b${READY}${GAP}saas\b`, "i")],
  production: [
    /\b(?:production[- ]ready|ready for production|ready to ship|in production|prod[- ]ready)\b/i,
    /\b(?:pronto para (?:a )?produção|em produção|pronto pra produção)/i,
    /\b(?:listo para (?:la )?producción|en producción)/i,
  ],
  done: [
    new RegExp(String.raw`\b${PRODUCT}\b${GAP}(?:is|est[aá]|fica|qued[oó]|ficou|esta)${GAP}?${READY}\b`, "i"),
    new RegExp(String.raw`\b${PRODUCT}\b\s+${READY}\b`, "i"),
  ],
};

const sentences = (text: string): readonly string[] =>
  text
    .split(/(?<=[.!?\n])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

export const findLabels = (text: string): readonly LabelHit[] => {
  const hits: LabelHit[] = [];
  for (const label of LABELS) {
    const phrase = sentences(text).find((sentence) => PATTERNS[label].some((pattern) => pattern.test(sentence)));
    if (phrase !== undefined) hits.push({ label, phrase: phrase.slice(0, 160) });
  }
  return hits;
};
