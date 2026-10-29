import type { Localized } from "./footprint-text.js";

export const PERSON_FOOTPRINT_TEXT = {
  parking: {
    en: "Ideas parked with `finitemonkey park` while a task is active: an id, the task, the text you typed and when. `finitemonkey unpark <id>` adds a line that brings one back. Nothing is parked without that command.",
    "pt-BR":
      "Ideias estacionadas com `finitemonkey park` enquanto uma tarefa está ativa: um id, a tarefa, o texto que você digitou e quando. `finitemonkey unpark <id>` acrescenta uma linha que traz uma de volta. Nada é estacionado sem esse comando.",
    es: "Ideas aparcadas con `finitemonkey park` mientras hay una tarea activa: un id, la tarea, el texto que escribiste y cuándo. `finitemonkey unpark <id>` agrega una línea que recupera una. Nada se aparca sin ese comando.",
  },
} as const satisfies Readonly<Record<"parking", Localized>>;
