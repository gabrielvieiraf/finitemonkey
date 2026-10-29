import type { Localized } from "./footprint-text.js";

export const GUARDIAN_FOOTPRINT_TEXT: Readonly<Record<"guardian", Localized>> = {
  guardian: {
    en: "Project goals, constraints, non-goals, done criteria and rejected options. An entry added from inside Claude Code is `inferred` and never counts as approved; only `finitemonkey guardian goal confirm`, run by the person in a terminal, marks it `stated`.",
    "pt-BR":
      "Objetivos do projeto, restrições, não objetivos, critérios de pronto e opções rejeitadas. Uma entrada adicionada de dentro do Claude Code fica `inferred` e nunca conta como aprovada; só o `finitemonkey guardian goal confirm`, rodado pela pessoa num terminal, a marca como `stated`.",
    es: "Objetivos del proyecto, restricciones, no objetivos, criterios de terminado y opciones rechazadas. Una entrada agregada desde Claude Code queda `inferred` y nunca cuenta como aprobada; solo `finitemonkey guardian goal confirm`, ejecutado por la persona en una terminal, la marca como `stated`.",
  },
};
