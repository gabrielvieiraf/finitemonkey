import { aliasesOf } from "../src/conceitos/book.js";
import { type Aliases, conceptPathOf, domainOf, resolveConcept } from "../src/conceitos/concepts.js";
import { yaml } from "./bench-state.js";

export interface ConceptResolver {
  readonly canon: (concept: unknown) => string;
  readonly domainOr: (concept: string, fallback: string) => string;
  readonly touches: (declared: readonly string[], observed: readonly string[]) => boolean;
}

export const conceptResolver = (aliases: Aliases = {}): ConceptResolver => {
  const canon = (concept: unknown): string => {
    if (typeof concept !== "string") return "";
    const id = resolveConcept(concept, aliases);
    if (id !== undefined) return id;
    return conceptPathOf(concept) === undefined ? concept : "";
  };
  return {
    canon,
    domainOr: (concept, fallback) => {
      const id = canon(concept);
      return id.includes("/") ? domainOf(id) : fallback;
    },
    touches: (declared, observed) => {
      const wanted = new Set(declared.map(canon).filter((id) => id !== ""));
      return observed.some((concept) => wanted.has(canon(concept)));
    },
  };
};

export const resolverAt = (dir: string): ConceptResolver =>
  conceptResolver(aliasesOf(yaml(dir, "conceitos.yml")?.["aliases"]));

const DEFAULT = conceptResolver();

export const canonConcept = DEFAULT.canon;
export const conceptDomainOr = DEFAULT.domainOr;
export const touchesDeclared = DEFAULT.touches;
