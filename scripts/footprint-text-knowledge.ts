import type { Localized } from "./footprint-text.js";

export const KNOWLEDGE_FOOTPRINT_TEXT: Readonly<Record<"knowledge", Localized>> = {
  knowledge: {
    en: "`claims.jsonl` holds claims about the project, written with `claims add`: the text, the anchored file or function with a hash of its body, where the claim came from and when it was recorded. Entries are appended and closed, never deleted. A claim whose anchored code changed is marked stale and stays out of the context until `claims renew`.",
    "pt-BR":
      "O `claims.jsonl` guarda afirmações sobre o projeto, escritas com `claims add`: o texto, o arquivo ou a função ancorada com um hash do corpo, de onde a afirmação veio e quando foi registrada. Entradas são acrescentadas e encerradas, nunca apagadas. Uma afirmação cujo código ancorado mudou fica marcada como vencida e fora do contexto até o `claims renew`.",
    es: "`claims.jsonl` guarda afirmaciones sobre el proyecto, escritas con `claims add`: el texto, el archivo o la función anclada con un hash de su cuerpo, de dónde vino la afirmación y cuándo se registró. Las entradas se agregan y se cierran, nunca se borran. Una afirmación cuyo código anclado cambió queda marcada como vencida y fuera del contexto hasta `claims renew`.",
  },
};
