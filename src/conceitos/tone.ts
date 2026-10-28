import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { readProfile } from "../perfil/store.js";
import { levelOf } from "../perfil/types.js";
import type { FmPaths } from "../task/paths.js";
import { raise, readBook, writeBook } from "./book.js";
import { domainOf, rankOf } from "./concepts.js";

export const TONED_CONCEPTS = ["secret-in-code"] as const;

export type TonedConcept = (typeof TONED_CONCEPTS)[number];

export type Tone = "short" | "long";

export const toneFor = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths, concept: TonedConcept): Tone => {
  const profile = readProfile(runtime, paths);
  const knowledge = profile?.domains[domainOf(concept)].knowledge;
  if (knowledge !== undefined && levelOf(knowledge) === "advanced") return "short";
  return rankOf(readBook(runtime, paths).concepts[concept]?.level) >= rankOf("explained") ? "short" : "long";
};

const longText = (t: Translate, concept: TonedConcept, human: string): string =>
  [
    human,
    t(`conceitos.tone.${concept}.why`),
    t(`conceitos.tone.${concept}.safe`),
    t(`conceitos.tone.${concept}.check`),
  ].join(" ");

export const tonedHuman = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  t: Translate,
  concept: TonedConcept,
  human: string,
): string => {
  if (toneFor(runtime, paths, concept) === "short") return human;
  writeBook(runtime, paths, raise(readBook(runtime, paths), concept, "explained", runtime.now()));
  return longText(t, concept, human);
};
