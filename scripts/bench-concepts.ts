import { domainOf, resolveConcept } from "../src/conceitos/concepts.js";

export const canonConcept = (concept: unknown): string =>
  typeof concept === "string" ? (resolveConcept(concept) ?? concept) : "";

export const conceptDomainOr = (concept: string, fallback: string): string => {
  const id = canonConcept(concept);
  return id.includes("/") ? domainOf(id) : fallback;
};

export const touchesDeclared = (declared: readonly string[], observed: readonly string[]): boolean => {
  const wanted = new Set(declared.map(canonConcept));
  return observed.some((concept) => wanted.has(canonConcept(concept)));
};
