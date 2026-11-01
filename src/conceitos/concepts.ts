import { type Domain, DOMAINS } from "../perfil/types.js";

export type ConceptId = string;

export const LEGACY_NAMES = [
  "api",
  "migration",
  "webhook",
  "idempotency",
  "force-push",
  "merge-conflict",
  "secret-in-code",
  "immutable-deploy",
] as const;

export type LegacyConcept = (typeof LEGACY_NAMES)[number];

export const LEGACY_CONCEPTS: Readonly<Record<LegacyConcept, ConceptId>> = {
  api: "backend/api/endpoint",
  migration: "backend/data/migration",
  webhook: "backend/integration/webhook",
  idempotency: "backend/reliability/idempotency",
  "force-push": "infrastructure/git/force-push",
  "merge-conflict": "infrastructure/git/merge-conflict",
  "secret-in-code": "security/secrets/secret-in-code",
  "immutable-deploy": "infrastructure/deploy/immutable-deploy",
};

export const CONCEPT_LEVELS = ["seen", "explained", "predicted", "used", "fixed"] as const;

export type ConceptLevel = (typeof CONCEPT_LEVELS)[number];

export type Aliases = Readonly<Record<string, ConceptId | null>>;

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_SEGMENTS = 3;
const MAX_HOPS = 8;

export const legacyNameOf = (id: ConceptId): LegacyConcept | undefined =>
  LEGACY_NAMES.find((name) => LEGACY_CONCEPTS[name] === id);

const legacyOf = (raw: string): ConceptId | undefined => {
  const name = LEGACY_NAMES.find((item) => item === raw);
  return name === undefined ? undefined : LEGACY_CONCEPTS[name];
};

export const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");

export const conceptPathOf = (raw: string | undefined): ConceptId | undefined => {
  const id = raw?.trim().toLowerCase();
  if (id === undefined || id === "") return undefined;
  const legacy = legacyOf(id);
  if (legacy !== undefined) return legacy;
  const segments = id.split("/");
  return segments.length <= MAX_SEGMENTS && segments.every((segment) => SEGMENT.test(segment)) ? id : undefined;
};

export const resolveConcept = (raw: string | undefined, aliases: Aliases = {}): ConceptId | undefined => {
  let id = conceptPathOf(raw);
  for (let hop = 0; id !== undefined && hop < MAX_HOPS && Object.hasOwn(aliases, id); hop += 1) {
    const next: ConceptId | null | undefined = aliases[id];
    if (next === null || next === undefined) return undefined;
    id = next;
  }
  return id;
};

export const canonicalConcept = (raw: string): string => legacyOf(raw.trim().toLowerCase()) ?? raw;

export const parseConcept = (raw: string | undefined, aliases: Aliases = {}): ConceptId | undefined => {
  const id = resolveConcept(raw, aliases);
  return id?.includes("/") === true ? id : undefined;
};

export const parseConceptLevel = (raw: string | undefined): ConceptLevel | undefined =>
  CONCEPT_LEVELS.find((level) => level === raw?.toLowerCase());

export const rankOf = (level: ConceptLevel | undefined): number =>
  level === undefined ? -1 : CONCEPT_LEVELS.indexOf(level);

export const domainOf = (id: ConceptId): string => {
  const path = conceptPathOf(id) ?? id;
  return path.split("/")[0] ?? path;
};

export const profileDomainOf = (id: ConceptId): Domain | undefined => DOMAINS.find((domain) => domain === domainOf(id));

export const leafOf = (id: ConceptId): string => id.split("/").at(-1) ?? id;
