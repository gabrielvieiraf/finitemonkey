import type { Domain } from "../perfil/types.js";

export const CONCEPT_IDS = [
  "api",
  "migration",
  "webhook",
  "idempotency",
  "force-push",
  "merge-conflict",
  "secret-in-code",
  "immutable-deploy",
] as const;

export type ConceptId = (typeof CONCEPT_IDS)[number];

export const CONCEPT_LEVELS = ["seen", "explained", "predicted", "used", "fixed"] as const;

export type ConceptLevel = (typeof CONCEPT_LEVELS)[number];

export interface Concept {
  readonly id: ConceptId;
  readonly domain: Domain;
  readonly pattern: RegExp;
}

export const CONCEPTS: readonly Concept[] = [
  { id: "api", domain: "backend", pattern: /\b(?:api|endpoint|rota de api|ruta de api)\b/i },
  { id: "migration", domain: "backend", pattern: /\bmigra(?:tion|[cç][aã]o|ci[oó]n)s?\b/i },
  { id: "webhook", domain: "backend", pattern: /\bwebhooks?\b/i },
  { id: "idempotency", domain: "backend", pattern: /\bidempoten\w*/i },
  { id: "force-push", domain: "infrastructure", pattern: /\b(?:force[- ]push|push --force|push -f)\b/i },
  {
    id: "merge-conflict",
    domain: "infrastructure",
    pattern: /\bmerge conflicts?\b|\bconflito de (?:merge|mescla)\b|\bconflicto de (?:merge|fusi[oó]n)\b/i,
  },
  {
    id: "secret-in-code",
    domain: "security",
    pattern: /\b(?:api key|secret key|chave secreta|clave secreta|hardcoded secret|segredo no c[oó]digo)\b/i,
  },
  {
    id: "immutable-deploy",
    domain: "infrastructure",
    pattern: /\b(?:immutable deploy|deploy imut[aá]vel|despliegue inmutable|rollback)\b/i,
  },
];

export const parseConcept = (raw: string | undefined): ConceptId | undefined =>
  CONCEPT_IDS.find((id) => id === raw?.toLowerCase());

export const parseConceptLevel = (raw: string | undefined): ConceptLevel | undefined =>
  CONCEPT_LEVELS.find((level) => level === raw?.toLowerCase());

export const rankOf = (level: ConceptLevel | undefined): number =>
  level === undefined ? -1 : CONCEPT_LEVELS.indexOf(level);

export const conceptsIn = (text: string): readonly ConceptId[] =>
  CONCEPTS.filter((concept) => concept.pattern.test(text)).map((concept) => concept.id);

export const domainOf = (id: ConceptId): Domain => CONCEPTS.find((concept) => concept.id === id)?.domain ?? "backend";
