import type { Lang } from "../../i18n/languages.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { ptBR } from "./pt-BR.js";
import type { BlueprintText } from "./types.js";

export const BLUEPRINT_TEXT: Readonly<Record<Lang, BlueprintText>> = { en, "pt-BR": ptBR, es };
