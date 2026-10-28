import { lazy, type PhraseRule, phrases } from "./catalog.js";
import { DENSITY_THRESHOLD } from "./types.js";

const CUE = [
  "eta",
  "estimated? (?:at )?",
  "estimates?",
  "takes?",
  "will take",
  "should take",
  "would take",
  "about",
  "around",
  "roughly",
  "approximately",
  "~",
  "leva",
  "levará",
  "levaria",
  "deve levar",
  "cerca de",
  "aproximadamente",
  "estimativa(?: de)?",
  "prazo(?: de)?",
  "tarda",
  "tardará",
  "lleva",
  "llevará",
  "estimación(?: de)?",
  "plazo(?: de)?",
  "unos",
  "unas",
].join("|");

const UNIT =
  "minutes?|mins?|hours?|hrs?|h|days?|weeks?|months?|sprints?|minutos?|horas?|dias?|días?|semanas?|meses|mês";
const AMOUNT = "\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|to|a|ou|or|o)\\s*\\d+(?:[.,]\\d+)?)?";

export const timeEstimateRules = lazy((): readonly PhraseRule[] => [
  {
    rule: "time-estimate",
    weight: DENSITY_THRESHOLD,
    patterns: [phrases(`(?:${CUE})\\s*:?\\s*${AMOUNT}\\s*(?:${UNIT})`), phrases("eta:?")],
  },
]);

export const PLAN_OR_REPORT =
  /(?:^|\/)(?:docs\/plan|reports?)\/|(?:^|\/)[^/]*(?:PLAN|REPORT|RELATORIO|RELATÓRIO|INFORME)[^/]*$/i;
