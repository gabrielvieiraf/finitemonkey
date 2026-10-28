import type { TaskSize } from "../task/types.js";

const BUILD =
  /\b(?:build|create|make|implement|add|develop|design|set ?up|migrate|refactor|rewrite|integrate)\b|(?<![\p{L}])(?:cri(?:ar|e|a)|constru(?:ir|a|ye)|implement(?:ar|e|a)|adicion(?:ar|e)|desenvolv(?:er|a)|migr(?:ar|e|a)|refator(?:ar|e)|reescrev(?:er|a)|fa(?:zer|ça)|integr(?:ar|e|a)|crear|crea|agreg(?:ar|a)|añad(?:ir|e)|desarroll(?:ar|a)|hac(?:er|e))(?![\p{L}])/iu;
const LARGE =
  /\b(?:app|application|platform|system|marketplace|saas|mvp|from scratch|end[- ]to[- ]end|backend and frontend)\b|(?<![\p{L}])(?:aplicativo|plataforma|sistema|do zero|aplicaci[oó]n|desde cero)(?![\p{L}])/iu;
const SMALL =
  /\b(?:typo|rename|bump|one[- ]line|log line|comment)\b|(?<![\p{L}])(?:renome(?:ar|ie)|erro de digita[çc][ãa]o|errata|renombr(?:ar|a))(?![\p{L}])/iu;
const JOINERS = /,|\b(?:and|with|plus)\b|(?<![\p{L}])(?:e|com|mais|y|con)(?![\p{L}])/giu;

export const MEDIUM_WORDS = 12;
export const BLUEPRINT_WORDS = 6;

export interface SizeHints {
  readonly blueprint: boolean;
}

export const requestSize = (prompt: string, hints: SizeHints): TaskSize => {
  const text = prompt.trim();
  if (text.startsWith("/") || !BUILD.test(text) || SMALL.test(text)) return "S";
  if (LARGE.test(text)) return "L";
  const words = text.split(/\s+/).length;
  const joins = text.match(JOINERS)?.length ?? 0;
  return words >= MEDIUM_WORDS || joins >= 2 || (hints.blueprint && words >= BLUEPRINT_WORDS) ? "M" : "S";
};
