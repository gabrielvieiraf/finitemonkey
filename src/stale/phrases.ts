export const STATUS_KINDS = ["unshipped", "unpublished", "experimental"] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

export interface StatusPhrase {
  readonly kind: StatusKind;
  readonly phrase: string;
}

const PATTERNS: Readonly<Record<StatusKind, readonly RegExp[]>> = {
  unpublished: [
    /\bnothing installs yet\b/i,
    /\bnot (?:yet )?published\b/i,
    /\bnot (?:yet )?on npm\b/i,
    /\bno release yet\b/i,
    /\bnada (?:se )?instala ainda\b/i,
    /\bainda n[ãa]o (?:foi )?publicad[oa]s?\b/i,
    /\bn[ãa]o (?:foi )?publicad[oa]s?\b/i,
    /\bnada se instala (?:todav[íi]a|a[úu]n)\b/i,
    /\bno (?:se ha )?publicad[oa]s?\b/i,
  ],
  unshipped: [
    /\*\*\(planned\)\*\*/i,
    /\bplanned\b/i,
    /\b(?:in|under) development\b/i,
    /\bnot (?:yet )?(?:available|implemented|built|shipped)\b/i,
    /\bcoming soon\b/i,
    /\bplanejad[oa]s?\b/i,
    /\bem desenvolvimento\b/i,
    /\bn[ãa]o (?:est[áa] )?dispon[íi]ve(?:l|is)\b/i,
    /\bainda n[ãa]o implementad[oa]s?\b/i,
    /\bem breve\b/i,
    /\bplanificad[oa]s?\b/i,
    /\ben desarrollo\b/i,
    /\bno (?:est[áa] )?disponibles?\b/i,
    /\b(?:todav[íi]a|a[úu]n) no implementad[oa]s?\b/i,
    /\bpr[óo]ximamente\b/i,
  ],
  experimental: [/\bexperimenta(?:l|is|les)\b/i],
};

export const statusOf = (text: string): StatusPhrase | undefined => {
  for (const kind of STATUS_KINDS) {
    for (const pattern of PATTERNS[kind]) {
      const match = pattern.exec(text);
      if (match !== null) return { kind, phrase: match[0] };
    }
  }
  return undefined;
};
