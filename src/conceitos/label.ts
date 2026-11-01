import type { Translate } from "../i18n/translate.js";
import { type ConceptId, leafOf, legacyNameOf } from "./concepts.js";

export const conceptLabel = (t: Translate, id: ConceptId): string => {
  const legacy = legacyNameOf(id);
  if (legacy !== undefined) return t(`conceitos.concept.${legacy}`);
  const parent = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : id;
  return t("conceitos.concept.open", { leaf: leafOf(id).replaceAll("-", " "), path: parent });
};
