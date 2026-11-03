import { isRecord } from "../core/parsed.js";
import type { ProposedContradiction } from "../instructions/drift.js";
import type { SuggestedConcept } from "../judge/concepts.js";
import type { ProposedHelp } from "../judge/horizon.js";
import { CRITERION_KINDS, HORIZON_KINDS } from "../judge/types.js";
import type { Span } from "../knowledge/retrieve.js";
import { type Stance, STANCES } from "../research/log.js";

const MAX_ITEMS = 20;
const MAX_TEXT = 2000;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, MAX_TEXT) : undefined;

const listOf = <T>(value: unknown, item: (raw: unknown) => T | undefined): readonly T[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .flatMap((raw: unknown) => {
      const parsed = item(raw);
      return parsed === undefined ? [] : [parsed];
    })
    .slice(0, MAX_ITEMS);
};

export const stringList = (value: unknown): readonly string[] | undefined => listOf(value, text);

export const recordList = (value: unknown): readonly Readonly<Record<string, unknown>>[] | undefined =>
  listOf(value, (raw) => (isRecord(raw) ? raw : undefined));

const at = (value: unknown): { readonly file: string; readonly line: number } | undefined => {
  if (!isRecord(value)) return undefined;
  const file = text(value["file"]);
  const line = value["line"];
  return file !== undefined && typeof line === "number" && Number.isInteger(line) && line > 0
    ? { file, line }
    : undefined;
};

export const contradictionPairs = (value: unknown): readonly ProposedContradiction[] | undefined =>
  listOf(value, (raw) => {
    if (!isRecord(raw)) return undefined;
    const first = at(raw["first"]);
    const second = at(raw["second"]);
    return first === undefined || second === undefined ? undefined : { first, second };
  });

export const sourceSpans = (
  value: unknown,
): readonly { readonly source: string; readonly span: string }[] | undefined =>
  listOf(value, (raw) => {
    if (!isRecord(raw)) return undefined;
    const source = text(raw["source"]);
    const span = text(raw["span"]);
    return source === undefined || span === undefined ? undefined : { source, span };
  });

export const spans = (value: unknown): readonly Span[] | undefined =>
  listOf(value, (raw) => {
    if (!isRecord(raw)) return undefined;
    const anchor = text(raw["anchor"]);
    const body = text(raw["text"]);
    return anchor === undefined || body === undefined ? undefined : { anchor, text: body };
  });

export const concepts = (value: unknown): readonly SuggestedConcept[] | undefined =>
  listOf(value, (raw) => {
    if (!isRecord(raw)) return undefined;
    const label = text(raw["label"]);
    const domain = text(raw["domain"]);
    if (label === undefined || domain === undefined) return undefined;
    return { label, domain, synonyms: stringList(raw["synonyms"]) ?? [] };
  });

export const helps = (value: unknown): readonly ProposedHelp[] | undefined =>
  listOf(value, (raw): ProposedHelp | undefined => {
    if (!isRecord(raw)) return undefined;
    const kind = HORIZON_KINDS.find((item) => item === raw["kind"]);
    const body = text(raw["text"]);
    if (kind === undefined || body === undefined) return undefined;
    const criterion = CRITERION_KINDS.find((item) => item === raw["criterion"]);
    const answer = text(raw["answer"]);
    return {
      kind,
      text: body,
      ...(criterion === undefined ? {} : { criterion }),
      ...(answer === undefined ? {} : { answer }),
    };
  });

export const stance = (value: unknown): Stance | undefined =>
  isRecord(value) ? STANCES.find((item) => item === value["stance"]) : undefined;

export const proposal = (value: unknown): string | undefined => (isRecord(value) ? text(value["proposal"]) : undefined);

export const pick = (value: unknown): "a" | "b" | undefined =>
  isRecord(value) && (value["pick"] === "a" || value["pick"] === "b") ? value["pick"] : undefined;

export const done = (value: unknown): boolean | undefined =>
  isRecord(value) && typeof value["done"] === "boolean" ? value["done"] : undefined;

const MAX_FILE = 20_000;

export const fileContent = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  const content = value["content"];
  return typeof content === "string" && content.trim() !== "" && content.length <= MAX_FILE ? content : undefined;
};

export const inputOnly = (value: unknown): { readonly input: string } | undefined => {
  const input = isRecord(value) ? text(value["input"]) : undefined;
  return input === undefined ? undefined : { input };
};

export const journeySteps = (value: unknown): { readonly steps: readonly unknown[] } | undefined =>
  isRecord(value) && Array.isArray(value["steps"]) && value["steps"].length > 0 ? { steps: value["steps"] } : undefined;
