import { type ConceptId, leafOf, LEGACY_CONCEPTS } from "./concepts.js";

const LEGACY_MENTIONS: readonly { readonly concept: ConceptId; readonly pattern: RegExp }[] = [
  { concept: LEGACY_CONCEPTS.api, pattern: /\b(?:api|endpoint|rota de api|ruta de api)\b/i },
  { concept: LEGACY_CONCEPTS.migration, pattern: /\bmigra(?:tion|[cç][aã]o|ci[oó]n)s?\b/i },
  { concept: LEGACY_CONCEPTS.webhook, pattern: /\bwebhooks?\b/i },
  { concept: LEGACY_CONCEPTS.idempotency, pattern: /\bidempoten\w*/i },
  { concept: LEGACY_CONCEPTS["force-push"], pattern: /\b(?:force[- ]push|push --force|push -f)\b/i },
  {
    concept: LEGACY_CONCEPTS["merge-conflict"],
    pattern: /\bmerge conflicts?\b|\bconflito de (?:merge|mescla)\b|\bconflicto de (?:merge|fusi[oó]n)\b/i,
  },
  {
    concept: LEGACY_CONCEPTS["secret-in-code"],
    pattern: /\b(?:api key|secret key|chave secreta|clave secreta|hardcoded secret|segredo no c[oó]digo)\b/i,
  },
  {
    concept: LEGACY_CONCEPTS["immutable-deploy"],
    pattern: /\b(?:immutable deploy|deploy imut[aá]vel|despliegue inmutable|rollback)\b/i,
  },
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const leafPattern = (id: ConceptId): RegExp =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escape(leafOf(id)).replace(/-/g, "[- ]")}($|[^\\p{L}\\p{N}])`, "iu");

const mentions = (text: string, id: ConceptId): boolean =>
  LEGACY_MENTIONS.some((item) => item.concept === id && item.pattern.test(text)) || leafPattern(id).test(text);

export const mentionedConcepts = (text: string, known: Iterable<ConceptId>): readonly ConceptId[] =>
  text.trim() === "" ? [] : [...new Set(known)].filter((id) => mentions(text, id));

export const firstMentionedDomainConcept = (text: string): ConceptId | undefined =>
  LEGACY_MENTIONS.find((item) => item.pattern.test(text))?.concept;
