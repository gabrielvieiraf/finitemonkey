import { type RuleBucket, type RuleScope, type RuleSeverity } from "./types.js";

export type ProposedDetector =
  | { readonly command: string }
  | { readonly path: string }
  | { readonly text: string; readonly on: readonly string[] }
  | { readonly lint: string }
  | { readonly check: string; readonly value?: string }
  | "attribution";

export interface Classified {
  readonly bucket: RuleBucket;
  readonly severity: RuleSeverity;
  readonly detector: ProposedDetector | undefined;
  readonly scope: RuleScope;
}

const NEGATED =
  /\b(never|not|don't|dont|doesn't|avoid|no|without|nunca|não|nao|evite|jamais|sem|jamás|jamas|evita|sin)\b|\bn['’]t\b/i;
const MUST = /\b(must|always|required|sempre|obrigat\w*|deve|siempre|debe|obligatori\w*)\b/i;
const MODAL =
  /\b(never|always|must|should|don't|do not|avoid|prefer|nunca|sempre|deve|devem|evite|prefira|siempre|debe|deben|evita|prefiere)\b/i;
const IMPERATIVE =
  /^(no|use|run|keep|write|add|follow|answer|respond|reply|open|ask|name|put|make|commit|push|test|check|read|create|delete|split|prefer|avoid|never|always|use|rode|rodar|mantenha|escreva|responda|abra|crie|leia|siga|usa|ejecuta|mantén|escribe|responde|abre|crea|lee|sigue|nunca|sempre|siempre)\b/i;

const ATTRIBUTION =
  /co-authored-by|\battribution\b|atribui\w*|generated with|gerado com|generado con|\bcredit\b|crédito/i;
const RESPONSE = /\b(respond|answer|reply|speak|talk|responda|responde|fale|conteste|contesta|habla)\b/i;
const LANGUAGES: readonly (readonly [RegExp, string])[] = [
  [/\b(english|inglês|ingles|inglés)\b/i, "en"],
  [/\b(portuguese|português|portugues|pt-br)\b/i, "pt-BR"],
  [/\b(spanish|espanhol|español|espanol|castellano)\b/i, "es"],
];
const TYPECHECK = /\btype-?check\w*|\btsc\b|\bmypy\b|\bpyright\b/i;
const TESTS = /\b(tests?|testes?|pruebas?)\b/i;
const RUN =
  /\b(run|runs|ran|pass|passes|passing|green|rode|rodar|roda|rodou|passa|passam|passar|ejecuta|ejecutar|correr|corre|pasan?)\b/i;
const COMMIT = /\b(commit|commits|committed|commitar|comitar|commite)\b/i;
const PUSH = /\bpush\b/i;
const BRANCH = /\b(main|master)\b|default branch|branch padrão|rama principal/i;
const SCOPE = /\boutside\b|\bfora d[eao]s?\b|\bfuera de\b|\bonly\b.*\b(edit|change|touch|modify)\b/i;
const EDIT =
  /\b(edit|edits|modify|change|touch|write|delete|commit|editar|edite|alterar|altere|mexa|apague|modificar|cambiar|toca|borra)\b/i;
const FILE_WORD = /\b(file|files|folder|directory|arquivo|arquivos|pasta|archivo|archivos|carpeta)\b/i;
const MESSAGE = /\b(commit message|commit messages|commit|commits|pull request|pr title|pr body|pr)\b/i;
const CONVENTIONAL = /conventional commits?/i;
const PROGRAMS = new Set([
  "git",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "bun",
  "rm",
  "curl",
  "wget",
  "docker",
  "kubectl",
  "terraform",
  "gh",
  "pip",
  "cargo",
  "go",
  "make",
  "psql",
  "sudo",
  "chmod",
]);
const COMMAND_WORDS = /\b(command|commands|terminal|shell|comando|comandos)\b/i;
const CODE_WORDS = /\b(file|files|code|component|function|module|arquivo|código|componente|função|archivo|función)\b/i;
const MAX_WORDS = 3;
const MIN_WORD = 5;

export const codeSpans = (text: string): readonly string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((match) => (match[1] ?? "").trim()).filter((span) => span !== "");

const isCommand = (span: string): boolean => PROGRAMS.has(span.split(/\s+/)[0] ?? "") && span.includes(" ");
const isPathLike = (span: string): boolean =>
  !span.includes(" ") && (/[/*]/.test(span) || /^\.[\w-]/.test(span) || /\.\w{1,6}$/.test(span));

const globOf = (span: string): string => (span.endsWith("/") ? `${span}**` : span);

export const isRuleLike = (text: string): boolean => MODAL.test(text) || IMPERATIVE.test(text.trim());

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const words = (text: string): readonly string[] =>
  [
    ...new Set(
      text
        .toLowerCase()
        .replace(/`[^`]*`/g, " ")
        .split(/[^\p{L}\p{N}-]+/u)
        .filter((word) => word.length >= MIN_WORD && !MODAL.test(word) && !NEGATED.test(word)),
    ),
  ]
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_WORDS);

export const scopeFor = (text: string): RuleScope => {
  const spans = codeSpans(text);
  const tools = [
    ...(spans.some(isCommand) || COMMAND_WORDS.test(text) ? ["Bash"] : []),
    ...(spans.some(isPathLike) || CODE_WORDS.test(text) ? ["Edit", "Write"] : []),
  ];
  return { paths: spans.filter(isPathLike).map(globOf), tools, words: words(text) };
};

const severityOf = (text: string): RuleSeverity => {
  if (NEGATED.test(text)) return "never";
  return MUST.test(text) ? "must" : "prefer";
};

const languageOf = (text: string): string | undefined => LANGUAGES.find(([pattern]) => pattern.test(text))?.[1];

const stopDetector = (text: string): ProposedDetector | undefined => {
  const language = languageOf(text);
  if (language !== undefined && RESPONSE.test(text) && !MESSAGE.test(text))
    return { check: "language", value: language };
  if (TYPECHECK.test(text)) return { check: "typecheck-ran" };
  if (TESTS.test(text) && RUN.test(text)) return { check: "tests-ran" };
  if (COMMIT.test(text) && BRANCH.test(text) && NEGATED.test(text) && !PUSH.test(text))
    return { check: "default-branch" };
  if (SCOPE.test(text) && codeSpans(text).some(isPathLike)) return { check: "scope" };
  return undefined;
};

const textDetector = (text: string): ProposedDetector | undefined => {
  const quoted = [...text.matchAll(/["“']([^"”']{2,40})["”']/g)].map((match) => match[1] ?? "");
  const literal = [...codeSpans(text), ...quoted][0];
  if (literal === undefined || !MESSAGE.test(text)) return undefined;
  const on = [...(COMMIT.test(text) ? ["commit"] : []), ...(/\b(pr|pull request)\b/i.test(text) ? ["pr"] : [])];
  return { text: escapeRegExp(literal), on: on.length === 0 ? ["commit", "pr"] : on };
};

const deterministicDetector = (text: string): ProposedDetector | undefined => {
  const negated = NEGATED.test(text);
  if (ATTRIBUTION.test(text) && negated) return "attribution";
  if (CONVENTIONAL.test(text)) return { lint: "commitlint" };
  const branch = /\b(main|master)\b/i.exec(text)?.[1];
  if (negated && PUSH.test(text) && branch !== undefined) return { command: `git push origin ${branch.toLowerCase()}` };
  if (!negated) return undefined;
  const spans = codeSpans(text);
  const command = spans.find(isCommand);
  if (command !== undefined) return { command };
  const path = spans.find(isPathLike);
  if (path !== undefined && (EDIT.test(text) || FILE_WORD.test(text)) && !MESSAGE.test(text))
    return { path: globOf(path) };
  return textDetector(text);
};

export const classifyStatement = (text: string): Classified => {
  const severity = severityOf(text);
  const scope = scopeFor(text);
  const stop = stopDetector(text);
  if (stop !== undefined) return { bucket: "stop", severity, detector: stop, scope };
  const deterministic = deterministicDetector(text);
  if (deterministic !== undefined) return { bucket: "deterministic", severity, detector: deterministic, scope };
  return { bucket: "reminder", severity, detector: undefined, scope };
};
