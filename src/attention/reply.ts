import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export type TimeboxReply = "continue" | "stop";

export interface TimeboxAsk {
  readonly task: string;
  readonly step: number;
  readonly pending: boolean;
  readonly answer: TimeboxReply | null;
}

const ASK_FILE = "timebox-ask.json";
const MAX_REPLY = 24;

const REPLIES: Readonly<Record<string, TimeboxReply>> = {
  continue: "continue",
  "go on": "continue",
  "keep going": "continue",
  continuar: "continue",
  continua: "continue",
  seguir: "continue",
  segue: "continue",
  sigue: "continue",
  stop: "stop",
  parar: "stop",
  pare: "stop",
  detener: "stop",
};

export const normalizeReply = (prompt: string): string =>
  prompt
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.!?,;:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const timeboxReply = (prompt: string): TimeboxReply | undefined => {
  if (prompt.length > MAX_REPLY) return undefined;
  return REPLIES[normalizeReply(prompt)];
};

const answerOf = (value: unknown): TimeboxReply | null => (value === "continue" || value === "stop" ? value : null);

export const readAsk = (runtime: Pick<Runtime, "readText">, paths: FmPaths): TimeboxAsk | undefined => {
  const raw = readJsonFile(runtime, paths.cache(ASK_FILE));
  if (raw === undefined || typeof raw["task"] !== "string" || typeof raw["step"] !== "number") return undefined;
  return { task: raw["task"], step: raw["step"], pending: raw["pending"] === true, answer: answerOf(raw["answer"]) };
};

export const writeAsk = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, ask: TimeboxAsk): void => {
  writeJsonFile(runtime, paths.cache(ASK_FILE), { ...ask });
};

export const shouldAsk = (ask: TimeboxAsk | undefined, task: string, step: number): boolean =>
  ask?.task !== task || (ask.answer === null && ask.step < step);
