import { isRecord, parseJson } from "../core/parsed.js";

export const UI_COPY_FEATURE = "ui-copy";
export const COPY_RULES = ["verb-first", "error-action", "one-name", "empty-label"] as const;

export type CopyRule = (typeof COPY_RULES)[number];
export type CopyLang = "en" | "pt" | "es";

export interface CopyFinding {
  readonly rule: CopyRule;
  readonly file: string;
  readonly key: string;
  readonly text: string;
  readonly detail: string;
}

export interface CatalogEntry {
  readonly file: string;
  readonly lang: CopyLang | undefined;
  readonly key: string;
  readonly text: string;
}

export interface CopyOptions {
  readonly allow: readonly string[];
  readonly buttonKeys: RegExp;
  readonly errorKeys: RegExp;
}

export const BUTTON_KEYS = /(?:^|[._-])(?:button|btn|cta|action)s?(?:[._-]|$)/i;
export const ERROR_KEYS = /(?:^|[._-])(?:error|errors|err|failure|failed)(?:[._-]|$)/i;

const VERBS: Readonly<Record<CopyLang, readonly string[]>> = {
  en: [
    "accept",
    "add",
    "apply",
    "approve",
    "archive",
    "back",
    "browse",
    "buy",
    "cancel",
    "change",
    "check",
    "choose",
    "clear",
    "close",
    "confirm",
    "connect",
    "continue",
    "copy",
    "create",
    "delete",
    "deploy",
    "disable",
    "discard",
    "dismiss",
    "download",
    "duplicate",
    "edit",
    "enable",
    "export",
    "filter",
    "find",
    "finish",
    "follow",
    "get",
    "go",
    "hide",
    "import",
    "install",
    "invite",
    "join",
    "learn",
    "leave",
    "load",
    "log",
    "manage",
    "merge",
    "move",
    "open",
    "pay",
    "pause",
    "preview",
    "print",
    "publish",
    "reject",
    "reload",
    "remove",
    "rename",
    "reply",
    "report",
    "request",
    "reset",
    "restore",
    "resume",
    "retry",
    "return",
    "review",
    "run",
    "save",
    "search",
    "select",
    "send",
    "set",
    "share",
    "show",
    "sign",
    "skip",
    "sort",
    "start",
    "stop",
    "submit",
    "subscribe",
    "switch",
    "sync",
    "try",
    "turn",
    "undo",
    "unlock",
    "update",
    "upgrade",
    "upload",
    "use",
    "verify",
    "view",
  ],
  pt: ["ver", "ir", "pôr", "sair", "abrir", "voltar", "seguir", "assinar", "subir", "excluir", "incluir", "fechar"],
  es: ["ver", "ir", "abrir", "volver", "seguir", "salir", "subir", "excluir", "incluir", "cerrar"],
};

const ACTIONS: Readonly<Record<CopyLang, RegExp>> = {
  en: /\b(?:try|retry|check|contact|enter|choose|select|use|add|remove|refresh|reload|sign in|log in|verify|update|wait|ask|make sure|fill|correct|review|go|open|install|run|restart|reconnect|change)\b/i,
  pt: /\b(?:tente|verifique|confira|contate|entre em contato|informe|digite|escolha|selecione|use|adicione|remova|atualize|recarregue|entre|faça login|aguarde|peça|preencha|corrija|revise|abra|instale|rode|reinicie|reconecte|troque|altere)\b/i,
  es: /\b(?:intenta|inténtalo|vuelve a intentar|verifica|revisa|contacta|comunícate|ingresa|escribe|elige|selecciona|usa|agrega|añade|quita|actualiza|recarga|inicia sesión|espera|pide|completa|corrige|abre|instala|ejecuta|reinicia|reconecta|cambia)\b/i,
};

export const langOf = (file: string): CopyLang | undefined => {
  const parts = file.toLowerCase().split(/[/\\.]/);
  if (parts.some((part) => part === "en" || part.startsWith("en-") || part.startsWith("en_"))) return "en";
  if (parts.some((part) => part === "pt" || part.startsWith("pt-") || part.startsWith("pt_"))) return "pt";
  if (parts.some((part) => part === "es" || part.startsWith("es-") || part.startsWith("es_"))) return "es";
  return undefined;
};

const flatten = (value: unknown, prefix: string): readonly (readonly [string, string])[] => {
  if (typeof value === "string") return [[prefix, value]];
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => flatten(inner, prefix === "" ? key : `${prefix}.${key}`));
};

export const catalogEntries = (file: string, text: string): readonly CatalogEntry[] => {
  const parsed = parseJson(text);
  if (!parsed.ok) return [];
  const lang = langOf(file);
  return flatten(parsed.value, "").map(([key, value]) => ({ file, lang, key, text: value }));
};

const firstWord = (text: string): string =>
  text
    .trim()
    .replace(/^[^\p{L}]+/u, "")
    .split(/[\s,.:;!?]+/u)[0]
    ?.toLowerCase() ?? "";

export const startsWithVerb = (text: string, lang: CopyLang): boolean => {
  const word = firstWord(text);
  if (VERBS[lang].includes(word)) return true;
  return lang !== "en" && /^\p{L}{2,}(?:ar|er|ir|ír)$/u.test(word);
};

const allowed = (entry: CatalogEntry, allow: readonly string[]): boolean => {
  const normal = entry.text.trim().toLowerCase();
  return allow.some((item) => item === entry.key || item.trim().toLowerCase() === normal);
};

const finding = (rule: CopyRule, entry: CatalogEntry, detail = ""): CopyFinding => ({
  rule,
  file: entry.file,
  key: entry.key,
  text: entry.text,
  detail,
});

export const labelFindings = (entries: readonly CatalogEntry[], options: CopyOptions): readonly CopyFinding[] =>
  entries.flatMap((entry): CopyFinding[] => {
    if (allowed(entry, options.allow) || entry.lang === undefined) return [];
    if (options.buttonKeys.test(entry.key)) {
      if (entry.text.trim() === "") return [finding("empty-label", entry)];
      return startsWithVerb(entry.text, entry.lang) ? [] : [finding("verb-first", entry)];
    }
    if (options.errorKeys.test(entry.key) && !ACTIONS[entry.lang].test(entry.text))
      return [finding("error-action", entry)];
    return [];
  });
