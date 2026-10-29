export type PremiseKind = "fact" | "correction";

export interface Premise {
  readonly kind: PremiseKind;
  readonly text: string;
  readonly refs: readonly string[];
}

const TEXT_MAX = 200;

const PREFERENCE: readonly RegExp[] = [
  /\b(?:i(?:'d)? (?:prefer|like|want|would rather)|let's|please (?:use|keep|call|name)|rather than)\b/i,
  /(?<![\p{L}])(?:prefiro|prefere|gosto mais|gostaria|quero que|vamos usar|melhor usar)(?![\p{L}])/iu,
  /(?<![\p{L}])(?:prefiero|me gusta m[áa]s|quiero que|mejor usar|usemos)(?![\p{L}])/iu,
];

const CORRECTION: readonly RegExp[] = [
  /^(?:no[,.!]|nope\b|that(?:'s| is) (?:wrong|not right|incorrect)|you(?:'re| are) wrong|actually,)/i,
  /^(?:n[ãa]o[,.!]|isso (?:est[áa] )?errado|voc[êe] (?:est[áa] )?errad[oa]|na verdade,)/iu,
  /^(?:no[,.!]|eso (?:est[áa] )?mal|est[áa]s equivocad[oa]|en realidad,)/iu,
];

const FACT: readonly RegExp[] = [
  /\b(?:already (?:handles?|does|checks?|exists?|returns?|covers?|validates?)|(?:is|are) (?:wrong|broken|unused|dead code|not used|never called)|(?:isn't|aren't|is not|are not) used|we (?:don't|do not|never) use|(?:doesn't|does not|don't|do not) (?:exist|handle|return|call)|always returns?|never (?:called|used|returns?))\b/i,
  /(?<![\p{L}])(?:j[áa] (?:trata|faz|verifica|existe|retorna|cobre|valida)|(?:est[áa]|est[ãa]o) errad[oa]s?|n[ãa]o (?:usamos|existe|trata|retorna|chama|[ée] usad[oa])|nunca [ée] chamad[oa]|sempre retorna)(?![\p{L}])/iu,
  /(?<![\p{L}])(?:ya (?:maneja|hace|verifica|existe|devuelve|cubre|valida)|(?:est[áa]|est[áa]n) mal|no (?:usamos|existe|maneja|devuelve|llama|se usa)|nunca se llama|siempre devuelve)(?![\p{L}])/iu,
];

const CODE_WORDS =
  /\b(?:function|method|class|test|tests|table|column|file|module|endpoint|route|variable|field|type|query|schema|hook|component)s?\b|(?<![\p{L}])(?:fun[çc][ãa]o|m[ée]todo|classe|teste|tabela|coluna|arquivo|m[óo]dulo|rota|vari[áa]vel|campo|funci[óo]n|clase|prueba|tabla|archivo|ruta)s?(?![\p{L}])/iu;

const PATH = /(?:^|[\s"'(`])((?:[\w.-]+\/)*[\w.-]+\.(?:[a-z]{1,5}))(?=$|[\s"'),:;`?!]|\.\s)/gi;
const SYMBOL = /`([^`\s]{2,80})`/g;

export const referencesIn = (text: string): readonly string[] => {
  const paths = [...text.matchAll(PATH)].map((match) => match[1] ?? "");
  const symbols = [...text.matchAll(SYMBOL)].map((match) => match[1] ?? "");
  return [...new Set([...paths, ...symbols].filter((ref) => ref !== "" && !/^\d+(?:\.\d+)*$/.test(ref)))];
};

const kindOf = (text: string): PremiseKind | undefined => {
  if (FACT.some((pattern) => pattern.test(text))) return "fact";
  return CORRECTION.some((pattern) => pattern.test(text.trim())) ? "correction" : undefined;
};

export const premiseIn = (prompt: string): Premise | undefined => {
  const text = prompt.trim();
  if (text === "" || PREFERENCE.some((pattern) => pattern.test(text))) return undefined;
  const kind = kindOf(text);
  if (kind === undefined) return undefined;
  const refs = referencesIn(text);
  if (refs.length === 0 && !CODE_WORDS.test(text)) return undefined;
  return { kind, text: text.slice(0, TEXT_MAX), refs };
};

const AGREEMENT: readonly RegExp[] = [
  /\byou(?:'re| are) (?:absolutely |completely |totally )?(?:right|correct)\b|\bgood catch\b|\bmy (?:mistake|bad)\b|\bi stand corrected\b/i,
  /(?<![\p{L}])(?:voc[êe] (?:tem|est[áa] com) (?:toda (?:a )?)?raz[ãa]o|tem raz[ãa]o|bem observado|erro meu|est[áa] cert[oa])(?![\p{L}])/iu,
  /(?<![\p{L}])(?:tienes (?:toda la )?raz[óo]n|buena observaci[óo]n|error m[íi]o|est[áa]s en lo cierto)(?![\p{L}])/iu,
];

export const agrees = (message: string): boolean => AGREEMENT.some((pattern) => pattern.test(message));
