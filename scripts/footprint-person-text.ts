import type { Localized } from "./footprint-text.js";

export const PERSON_FOOTPRINT_TEXT = {
  "session-logs": {
    en: "This project's local Claude Code session logs: read once with `init --look-back`, and read incrementally on each prompt only when a spend budget is set in `.finitemonkey/config.yml`. `finitemonkey drift` (and, unless the drift-sensor flag is off, a background run at most once a day after a turn) counts tool calls, model and version per day from them; only those counts are kept, in `.finitemonkey/cache/drift.json`.",
    "pt-BR":
      "Os logs locais de sessão do Claude Code deste projeto: lidos uma vez com `init --look-back`, e lidos aos poucos a cada prompt só quando há um teto de gasto em `.finitemonkey/config.yml`. O `finitemonkey drift` (e, salvo com a flag drift-sensor desligada, uma rodada em segundo plano no máximo uma vez por dia depois de um turno) conta chamadas de ferramenta, modelo e versão por dia a partir deles; só essas contagens ficam guardadas, em `.finitemonkey/cache/drift.json`.",
    es: "Los logs locales de sesión de Claude Code de este proyecto: leídos una vez con `init --look-back`, y leídos de a poco en cada prompt solo cuando hay un tope de gasto en `.finitemonkey/config.yml`. `finitemonkey drift` (y, salvo con la flag drift-sensor apagada, una corrida en segundo plano como mucho una vez al día después de un turno) cuenta llamadas de herramientas, modelo y versión por día a partir de ellos; solo esas cuentas se guardan, en `.finitemonkey/cache/drift.json`.",
  },
  parking: {
    en: "Ideas parked with `finitemonkey park` while a task is active: an id, the task, the text you typed and when. `finitemonkey unpark <id>` adds a line that brings one back. Nothing is parked without that command.",
    "pt-BR":
      "Ideias estacionadas com `finitemonkey park` enquanto uma tarefa está ativa: um id, a tarefa, o texto que você digitou e quando. `finitemonkey unpark <id>` acrescenta uma linha que traz uma de volta. Nada é estacionado sem esse comando.",
    es: "Ideas aparcadas con `finitemonkey park` mientras hay una tarea activa: un id, la tarea, el texto que escribiste y cuándo. `finitemonkey unpark <id>` agrega una línea que recupera una. Nada se aparca sin ese comando.",
  },
} as const satisfies Readonly<Record<"session-logs" | "parking", Localized>>;
