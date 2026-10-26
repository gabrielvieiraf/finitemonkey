import type { Lang } from "../../i18n/languages.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { ptBR } from "./pt-BR.js";
import type { GeneratedTemplates } from "./types.js";

export type { GeneratedTemplates } from "./types.js";

export const TEMPLATES: Readonly<Record<Lang, GeneratedTemplates>> = { en, "pt-BR": ptBR, es };
