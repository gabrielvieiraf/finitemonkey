import type { JsonObject } from "../src/core/parsed.js";
import type { Persona } from "./bench-family.js";
import { KINDS, observe, react, type ReactionKind } from "./bench-persona.js";
import { jsonLines } from "./bench-transcript.js";

export interface Label {
  readonly persona: string;
  readonly message: string;
  readonly testsRan: boolean | undefined;
  readonly human: ReactionKind | undefined;
}

export interface Agreement {
  readonly persona: string;
  readonly n: number;
  readonly agree: number;
  readonly percent: number;
  readonly kappa: number | null;
}

const NO_INTENTS = { goal: "", acceptance: "", constraints: "" };

export const parseLabel = (raw: JsonObject): Label | undefined => {
  const { persona, message, testsRan } = raw;
  if (typeof persona !== "string" || typeof message !== "string") return undefined;
  const human = raw["human"] === null ? undefined : KINDS.find((kind) => kind === raw["human"]);
  if (raw["human"] !== null && raw["human"] !== undefined && human === undefined) return undefined;
  return { persona, message, testsRan: typeof testsRan === "boolean" ? testsRan : undefined, human };
};

export const simulated = (persona: Persona, label: Label): ReactionKind =>
  react(persona.behavior, NO_INTENTS, {
    finalMessage: label.message,
    testsRan: persona.behavior.observes.includes("commands") ? label.testsRan === true : undefined,
  }).kind;

export const cohenKappa = (pairs: readonly (readonly [string, string])[]): number | null => {
  if (pairs.length === 0) return null;
  const n = pairs.length;
  const observed = pairs.filter(([left, right]) => left === right).length / n;
  const categories = [...new Set(pairs.flatMap(([left, right]) => [left, right]))];
  const expected = categories.reduce((sum, category) => {
    const left = pairs.filter(([value]) => value === category).length / n;
    const right = pairs.filter(([, value]) => value === category).length / n;
    return sum + left * right;
  }, 0);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
};

const summarize = (persona: string, pairs: readonly (readonly [string, string])[]): Agreement => {
  const agree = pairs.filter(([left, right]) => left === right).length;
  return {
    persona,
    n: pairs.length,
    agree,
    percent: pairs.length === 0 ? 0 : agree / pairs.length,
    kappa: cohenKappa(pairs),
  };
};

export const agreement = (personas: readonly Persona[], labels: readonly Label[]): readonly Agreement[] => {
  const pairsOf = (wanted: string | undefined): (readonly [string, string])[] =>
    labels.flatMap((label) => {
      const persona = personas.find((item) => item.id === label.persona);
      if (persona === undefined || label.human === undefined) return [];
      if (wanted !== undefined && label.persona !== wanted) return [];
      return [[simulated(persona, label), label.human] as const];
    });
  return [
    ...personas.map((persona) => summarize(persona.id, pairsOf(persona.id))),
    summarize("all", pairsOf(undefined)),
  ];
};

export const sheetRows = (
  records: readonly JsonObject[],
  transcripts: (run: string) => string,
): readonly JsonObject[] =>
  records.flatMap((record) => {
    const run = record["run"];
    const task = record["task"];
    if (typeof run !== "string" || typeof task !== "string") return [];
    const persona = task.split(".").at(-1) ?? "";
    const lines = transcripts(run).split("\n");
    return lines.flatMap((line, index) => {
      const seen = lines.slice(0, index + 1).join("\n");
      const view = observe(["final-message", "commands"], seen);
      return jsonLines(line).some((item) => item["type"] === "result")
        ? [{ run, persona, message: view.finalMessage, testsRan: view.testsRan ?? false, human: null }]
        : [];
    });
  });
