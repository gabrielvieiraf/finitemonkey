import { type ConceptId, slugOf } from "./concepts.js";
import { firstMentionedDomainConcept } from "./mentions.js";
import { fieldOfWords } from "./prompt-fields.js";

const CUES = [
  "i'?m",
  "i am",
  "i want to",
  "i'?d like to",
  "i need to",
  "trying to",
  "help me",
  "estou",
  "quero",
  "queria",
  "preciso",
  "tentando",
  "me ajuda a",
  "me ajude a",
  "estoy",
  "quiero",
  "necesito",
  "tratando de",
  "intentando",
  "ayudame a",
].join("|");

const VERBS = [
  "understand",
  "learn",
  "learning",
  "study",
  "studying",
  "research",
  "researching",
  "entender",
  "entendendo",
  "compreender",
  "aprender",
  "aprendendo",
  "estudar",
  "estudando",
  "pesquisar",
  "pesquisando",
  "comprender",
  "estudiar",
  "estudiando",
  "aprendiendo",
  "investigar",
  "investigando",
].join("|");

const INTENT = new RegExp(`(?:^|[^a-z])(?:${CUES})(?:\\s+[a-z']+){0,3}?\\s+(?:${VERBS})\\s+([^.,;:!?\\n]+)`);
const TEACH = /(?:^|[^a-z])(?:teach me|me ensina|me ensine|ensename)\s+([^.,;:!?\n]+)/;

const FILLERS: ReadonlySet<string> = new Set(
  "about more a an the some sobre mais melhor o os as um uma de do da dos das el la los las un una mas mejor acerca".split(
    " ",
  ),
);

const STOPS: ReadonlySet<string> = new Set(
  [
    "properly better because so and but for to in with now today please since while",
    "porque para com e mas agora hoje pois enquanto desde",
    "y pero con ahora hoy por mientras",
  ]
    .join(" ")
    .split(" "),
);

const REJECTED: ReadonlySet<string> = new Set(
  [
    "this that it these those why what how where when which who my your our their its",
    "isso isto esse essa este esta aqui como que onde quando qual meu minha seu sua nosso",
    "eso esto ese esa aqui cual donde cuando mi tu su nuestro",
    "code codebase error errors bug bugs file files function test tests repo project issue diff output",
    "codigo erro arquivo arquivos funcao teste testes projeto saida",
    "archivo archivos funcion prueba pruebas proyecto salida",
  ]
    .join(" ")
    .split(" "),
);

const MAX_WORDS = 3;
const CODE_LIKE = /[/_`(){}=<>\\@#$%*[\]]/;

export const plainText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

const topicWords = (raw: string): readonly string[] | undefined => {
  if (CODE_LIKE.test(raw)) return undefined;
  const words = raw.split(/\s+/).filter((word) => word !== "");
  const start = words.findIndex((word) => !FILLERS.has(word));
  const rest = start < 0 ? [] : words.slice(start);
  const end = rest.findIndex((word) => STOPS.has(word));
  const head = (end < 0 ? rest : rest.slice(0, end)).slice(0, MAX_WORDS);
  const last = head.findLastIndex((word) => !FILLERS.has(word));
  const kept = head.slice(0, last + 1);
  if (kept.length === 0 || kept.some((word) => REJECTED.has(word))) return undefined;
  return kept;
};

export const studiedTopic = (prompt: string): string | undefined => {
  const text = plainText(prompt);
  const raw = INTENT.exec(text)?.[1] ?? TEACH.exec(text)?.[1];
  const words = raw === undefined ? undefined : topicWords(raw.trim());
  const slug = words === undefined ? "" : slugOf(words.join(" "));
  return slug.length < 3 ? undefined : slug;
};

export const conceptOfTopic = (topic: string): ConceptId =>
  firstMentionedDomainConcept(topic.replace(/-/g, " ")) ?? `${fieldOfWords(topic.split("-"))}/${topic}`;

export const studiedConcept = (prompt: string): ConceptId | undefined => {
  const topic = studiedTopic(prompt);
  return topic === undefined ? undefined : conceptOfTopic(topic);
};
