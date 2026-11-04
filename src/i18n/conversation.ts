import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { FM_DIR } from "../task/paths.js";
import { type Lang, normalizeLang } from "./languages.js";

export const CONVERSATION_LANG_FILE = "conversation-lang.json";

export const MIN_WORDS = 4;
export const MIN_HITS = 2;

const words = (list: string): ReadonlySet<string> => new Set(list.split(" "));

const STOPWORDS: Readonly<Record<Lang, ReadonlySet<string>>> = {
  en: words(
    "the and is are you to of it that this with for what how please can not do does why should would i my we in on be have there just make fix add was will if when where which they them your from about",
  ),
  "pt-BR": words(
    "não nao é o os um uma pra com isso esse essa tem está ta tá você voce vc eu mas mais aqui fica ficar faz fazer onde muito também tambem já ja então entao gente só ser vai tô ali coisa agora porque mesmo nos ao aos dos das na no nas num pela pelo seu sua precisa quero",
  ),
  es: words(
    "el la los las un una con es está y pero más aquí qué tiene hay esto eso usted tú yo cuando donde dónde muy también ya entonces hacer puede ser del al su sus lo le les ahora porque quiero necesito este esta",
  ),
};

const MARKS: readonly (readonly [Lang, RegExp])[] = [
  ["pt-BR", /[ãõç]/u],
  ["es", /[ñ¿¡]/u],
];

const stripCode = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\S*[/\\]\S*/g, " ");

export const guessLang = (text: string): Lang | undefined => {
  const plain = stripCode(text).toLowerCase();
  const tokens = plain.match(/\p{L}+/gu) ?? [];
  if (tokens.length < MIN_WORDS) return undefined;
  const scores = (Object.keys(STOPWORDS) as Lang[]).map((lang) => {
    const hits = tokens.filter((token) => STOPWORDS[lang].has(token)).length;
    const marks = MARKS.some(([owner, pattern]) => owner === lang && pattern.test(plain)) ? 2 : 0;
    return { lang, score: hits + marks };
  });
  const [first, second] = [...scores].sort((a, b) => b.score - a.score);
  if (first === undefined || first.score < MIN_HITS) return undefined;
  return second !== undefined && first.score < second.score * 2 ? undefined : first.lang;
};

export const conversationLangPath = (root: AbsolutePath): AbsolutePath =>
  toAbsolutePath(join(root, FM_DIR, "cache", CONVERSATION_LANG_FILE));

export const readConversationLang = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): Lang | undefined => {
  const text = runtime.readText(conversationLangPath(root));
  if (!text.ok) return undefined;
  const parsed = parseJsonObject(text.value);
  const lang = parsed.ok && isRecord(parsed.value) ? parsed.value["lang"] : undefined;
  return typeof lang === "string" ? normalizeLang(lang) : undefined;
};

export const recordConversationLang = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now">,
  root: AbsolutePath,
  prompt: string,
): Lang | undefined => {
  const lang = guessLang(prompt);
  if (lang === undefined || lang === readConversationLang(runtime, root)) return lang;
  runtime.mkdir(toAbsolutePath(join(root, FM_DIR, "cache")));
  runtime.writeText(conversationLangPath(root), `${JSON.stringify({ lang, at: runtime.now() })}\n`);
  return lang;
};
