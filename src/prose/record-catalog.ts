import { casedPhrases, lazy, type PhraseRule, phrases } from "./catalog.js";
import { DENSITY_THRESHOLD } from "./types.js";

const TECH_NOUNS = [
  "readme",
  "commit",
  "pr",
  "issue",
  "botão",
  "erro",
  "aviso",
  "bloqueio",
  "hook",
  "portão",
  "prompt",
  "modal",
  "rodapé",
  "cabeçalho",
  "título",
  "menu",
  "banner",
  "changelog",
  "site",
  "app",
  "formulário",
  "plugin",
  "comando",
  "contrato",
  "relatório",
  "projeto",
  "arquivo",
  "código",
  "pacote",
  "repositório",
  "produto",
  "módulo",
  "sistema",
].join("|");

const REQUESTER = (): readonly RegExp[] => [
  phrases(
    "as requested",
    "per (?:your|the user's|their) request",
    "as you (?:asked|requested|wanted)",
    "the user (?:asked|wants|wanted|requested)",
    "as discussed",
    "as agreed",
    "per (?:the|our) (?:conversation|discussion|chat)",
  ),
  phrases(
    "conforme (?:solicitado|pedido|combinado)",
    "a pedido d[oa]",
    "como (?:pedido|solicitado|combinado|conversado)",
    "como você (?:pediu|quer|queria)",
    "o usuário (?:pediu|quer|queria)",
  ),
  phrases(
    "según lo (?:pedido|solicitado|acordado)",
    "a (?:pedido|petición) de",
    "como (?:pediste|se pidió|acordamos)",
    "el usuario (?:pidió|quiere|quería)",
  ),
];

const PERSON = (): readonly RegExp[] => [
  casedPhrases("\\p{Lu}\\p{Ll}+'s (?:text|request|idea|suggestion|wording|preference|feedback)"),
  phrases(`(?:texto|pedido|ideia|sugestão|preferência|gosto) d[oa] (?!(?:${TECH_NOUNS})(?![\\p{L}\\p{N}]))\\p{L}+`),
  casedPhrases("(?:texto|pedido|idea|sugerencia|preferencia) de \\p{Lu}\\p{Ll}+"),
];

const ORIGIN = (): readonly RegExp[] => [
  phrases("in the style of", "(?:just )?like \\S+ does", "inspired by", "copied from"),
  phrases("no estilo d[oa]", "igual a[oà]s?", "inspirad[oa] n[oa]", "como o \\S+ faz"),
  phrases("al estilo de", "igual que", "como hace \\S+", "inspirad[oa] en"),
];

const FIRST_PERSON = (): readonly RegExp[] => [
  phrases("I (?:changed|added|fixed|made|updated|removed|did|think|decided)", "you (?:asked|wanted|requested)"),
  phrases(
    "fiz",
    "eu (?:mudei|troquei|adicionei|corrigi|fiz|acho)",
    "mudei",
    "troquei",
    "adicionei",
    "corrigi",
    "você (?:pediu|quis)",
  ),
  phrases("hice", "cambié", "añadí", "arreglé", "corregí", "pediste", "(?:tú|usted) (?:pediste|pidió)"),
];

const PADDING = (): readonly RegExp[] => [
  phrases(
    "this commit",
    "this (?:PR|pull request) (?:aims|is meant|is intended|seeks|tries) to",
    "the (?:purpose|goal) of this (?:PR|pull request|commit)",
  ),
  phrases("este commit", "este PR (?:tem como objetivo|visa|busca|pretende)", "o objetivo deste (?:PR|commit)"),
  phrases("este commit", "este PR (?:tiene como objetivo|busca|pretende)", "el objetivo de este (?:PR|commit)"),
];

export const recordRules = lazy((): readonly PhraseRule[] => [
  { rule: "requester-reference", weight: DENSITY_THRESHOLD, patterns: REQUESTER() },
  { rule: "person-as-reason", weight: DENSITY_THRESHOLD, patterns: PERSON() },
  { rule: "origin-project", weight: DENSITY_THRESHOLD, patterns: ORIGIN() },
  { rule: "first-person", weight: DENSITY_THRESHOLD, patterns: FIRST_PERSON() },
  { rule: "padding", weight: DENSITY_THRESHOLD, patterns: PADDING() },
]);
