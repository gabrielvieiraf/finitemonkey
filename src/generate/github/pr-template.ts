import type { Lang } from "../../i18n/languages.js";
import type { GenFile } from "../files.js";

export const PR_TEMPLATE_FILE = ".github/pull_request_template.md";

export const PR_TEMPLATE_PLACES = [
  PR_TEMPLATE_FILE,
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
] as const;

interface PrTemplateText {
  readonly issue: string;
  readonly closes: string;
  readonly changes: string;
  readonly screenshots: string;
  readonly phone: string;
  readonly desktop: string;
  readonly tests: string;
  readonly risk: string;
  readonly revert: string;
  readonly checklist: string;
  readonly items: readonly string[];
}

const TEXT: Readonly<Record<Lang, PrTemplateText>> = {
  en: {
    issue: "Linked issue",
    closes: "Closes #",
    changes: "What changes",
    screenshots: "Screenshots",
    phone: "Phone",
    desktop: "Desktop",
    tests: "Tests",
    risk: "Risk",
    revert: "How to revert",
    checklist: "Checklist",
    items: [
      "The title follows Conventional Commits",
      "API contract, mocks and screens changed together, or not applicable",
      "Loading, empty and error states covered",
      "Works with the keyboard",
      "User-facing text reviewed",
      "`finitemonkey gate` passes",
    ],
  },
  "pt-BR": {
    issue: "Issue ligada",
    closes: "Closes #",
    changes: "O que muda",
    screenshots: "Prints",
    phone: "Celular",
    desktop: "Computador",
    tests: "Testes",
    risk: "Risco",
    revert: "Como reverter",
    checklist: "Checklist",
    items: [
      "O título segue Conventional Commits",
      "Contrato da API, mocks e telas mudaram juntos, ou não se aplica",
      "Estados de carregando, vazio e erro cobertos",
      "Funciona pelo teclado",
      "Textos para o usuário revisados",
      "`finitemonkey gate` passa",
    ],
  },
  es: {
    issue: "Issue vinculada",
    closes: "Closes #",
    changes: "Qué cambia",
    screenshots: "Capturas",
    phone: "Teléfono",
    desktop: "Escritorio",
    tests: "Pruebas",
    risk: "Riesgo",
    revert: "Cómo revertir",
    checklist: "Checklist",
    items: [
      "El título sigue Conventional Commits",
      "Contrato de la API, mocks y pantallas cambiaron juntos, o no aplica",
      "Estados de carga, vacío y error cubiertos",
      "Funciona con el teclado",
      "Textos para el usuario revisados",
      "`finitemonkey gate` pasa",
    ],
  },
};

export const prTemplate = (lang: Lang): string => {
  const text = TEXT[lang];
  return [
    `## ${text.issue}`,
    "",
    text.closes,
    "",
    `## ${text.changes}`,
    "",
    `## ${text.screenshots}`,
    "",
    `| ${text.phone} | ${text.desktop} |`,
    "| --- | --- |",
    "|  |  |",
    "",
    `## ${text.tests}`,
    "",
    `## ${text.risk}`,
    "",
    `## ${text.revert}`,
    "",
    `## ${text.checklist}`,
    "",
    ...text.items.map((item) => `- [ ] ${item}`),
    "",
  ].join("\n");
};

export const prTemplateFile = (lang: Lang, exists: (path: string) => boolean): GenFile => ({
  path: PR_TEMPLATE_PLACES.find(exists) ?? PR_TEMPLATE_FILE,
  text: prTemplate(lang),
});
