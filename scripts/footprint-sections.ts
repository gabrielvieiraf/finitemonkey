import type { FootprintKind } from "../src/core/footprint.js";
import type { Lang } from "./footprint-text.js";

export const SECTION_TEXT: Readonly<
  Record<
    Lang,
    {
      readonly heading: string;
      readonly intro: string;
      readonly kinds: Readonly<Record<FootprintKind, string>>;
      readonly what: string;
      readonly why: string;
    }
  >
> = {
  en: {
    heading: "What it reads, writes and sends",
    intro:
      "Generated from `src/core/footprint.ts`, the list the tests hold the code to. No telemetry. Paths are relative to the project unless they start with `~`.",
    kinds: { reads: "Reads", writes: "Writes", sends: "Sends" },
    what: "What",
    why: "Why",
  },
  "pt-BR": {
    heading: "O que ele lê, grava e envia",
    intro:
      "Gerado a partir de `src/core/footprint.ts`, a lista que os testes cobram do código. Sem telemetria. Caminhos são relativos ao projeto, exceto os que começam com `~`.",
    kinds: { reads: "Lê", writes: "Grava", sends: "Envia" },
    what: "O quê",
    why: "Para quê",
  },
  es: {
    heading: "Qué lee, escribe y envía",
    intro:
      "Generado desde `src/core/footprint.ts`, la lista que los tests exigen al código. Sin telemetría. Las rutas son relativas al proyecto salvo las que empiezan con `~`.",
    kinds: { reads: "Lee", writes: "Escribe", sends: "Envía" },
    what: "Qué",
    why: "Para qué",
  },
};
