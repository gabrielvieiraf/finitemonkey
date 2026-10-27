import type { MessageKey } from "../i18n/catalogs.js";
import type { Domain } from "./types.js";

export const OPTIONS = ["a", "b", "c"] as const;

export type Option = (typeof OPTIONS)[number];

export interface Question {
  readonly text: MessageKey;
  readonly options: Readonly<Record<Option, MessageKey>>;
}

export interface DomainQuestion extends Question {
  readonly correct: Option;
}

export const DOMAIN_QUESTIONS: Readonly<Record<Domain, DomainQuestion>> = {
  product: {
    text: "perfil.q.product",
    options: { a: "perfil.q.product.a", b: "perfil.q.product.b", c: "perfil.q.product.c" },
    correct: "c",
  },
  interface: {
    text: "perfil.q.interface",
    options: { a: "perfil.q.interface.a", b: "perfil.q.interface.b", c: "perfil.q.interface.c" },
    correct: "b",
  },
  backend: {
    text: "perfil.q.backend",
    options: { a: "perfil.q.backend.a", b: "perfil.q.backend.b", c: "perfil.q.backend.c" },
    correct: "b",
  },
  infrastructure: {
    text: "perfil.q.infrastructure",
    options: { a: "perfil.q.infrastructure.a", b: "perfil.q.infrastructure.b", c: "perfil.q.infrastructure.c" },
    correct: "b",
  },
  security: {
    text: "perfil.q.security",
    options: { a: "perfil.q.security.a", b: "perfil.q.security.b", c: "perfil.q.security.c" },
    correct: "b",
  },
};

export const TOOL_QUESTION: Question = {
  text: "perfil.q.tool",
  options: { a: "perfil.q.tool.a", b: "perfil.q.tool.b", c: "perfil.q.tool.c" },
};

export const TOOL_SCORES: Readonly<Record<Option, number>> = { a: 75, b: 55, c: 30 };

export const CORRECT_SCORE = 70;
export const WRONG_SCORE = 30;

export const parseOption = (raw: string | undefined): Option | undefined =>
  OPTIONS.find((option) => option === raw?.trim().toLowerCase());
