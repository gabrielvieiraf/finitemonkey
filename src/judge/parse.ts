import { isRecord, type JsonObject } from "../core/parsed.js";
import {
  ANCHOR_KINDS,
  type Band,
  BANDS,
  CLAIM_KINDS,
  CONCEPT_ORIGINS,
  CRITERION_KINDS,
  DECIDERS,
  EVENT_CAUSES,
  EVENT_STATES,
  HORIZON_KINDS,
  HORIZON_STATES,
  type JudgeAnchor,
  type JudgeEntry,
  oneOf,
  ORIGINS,
  PROBE_FORMS,
  PROOF_KINDS,
  RESULTS,
  SUPPORT_STATES,
} from "./types.js";

const text = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const texts = (record: JsonObject, key: string): readonly string[] => {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
};

const optional = (record: JsonObject, keys: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const found = text(record, key);
      return found === undefined ? [] : [[key, found]];
    }),
  );

const anchorOf = (value: unknown): JudgeAnchor | undefined => {
  if (!isRecord(value)) return undefined;
  const kind = oneOf(ANCHOR_KINDS, value["kind"]);
  const ref = text(value, "ref");
  const hash = text(value, "hash");
  if (kind === undefined || ref === undefined || hash === undefined) return undefined;
  const inputs = texts(value, "inputs");
  return { kind, ref, hash, ...optional(value, ["span"]), ...(inputs.length === 0 ? {} : { inputs }) };
};

export const anchorsOf = (value: unknown): readonly JudgeAnchor[] =>
  Array.isArray(value) ? value.flatMap((item) => anchorOf(item) ?? []) : [];

export const bandsOf = (value: unknown): Readonly<Record<string, Band>> | undefined => {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, band]) => {
      const known = oneOf(BANDS, band);
      return known === undefined ? [] : [[key, known]];
    }),
  );
};

type Parser = (record: JsonObject, base: { readonly id: string; readonly at: string }) => JudgeEntry | undefined;

const conceptOf: Parser = (record, base) => {
  const domain = text(record, "domain");
  const label = text(record, "label");
  const origin = oneOf(CONCEPT_ORIGINS, record["origin"]);
  if (domain === undefined || label === undefined || origin === undefined) return undefined;
  const synonyms = texts(record, "synonyms");
  return { type: "concept", ...base, domain, label, synonyms, anchors: anchorsOf(record["anchors"]), origin };
};

const evidenceOf: Parser = (record, base) => {
  const proof = oneOf(PROOF_KINDS, record["proof"]);
  const result = oneOf(RESULTS, record["result"]);
  const origin = oneOf(ORIGINS, record["origin"]);
  const ref = text(record, "ref") ?? (proof === "exposure" ? "exposure" : undefined);
  if (proof === undefined || result === undefined || origin === undefined || ref === undefined) return undefined;
  const concepts = texts(record, "concepts");
  return { type: "evidence", ...base, concepts, proof, result, ref, origin, ...optional(record, ["claim"]) };
};

const claimOf: Parser = (record, base) => {
  const claimText = text(record, "text");
  const kind = oneOf(CLAIM_KINDS, record["kind"]);
  if (claimText === undefined || kind === undefined) return undefined;
  const because = texts(record, "because");
  return {
    type: "claim",
    ...base,
    text: claimText,
    kind,
    concepts: texts(record, "concepts"),
    anchors: anchorsOf(record["anchors"]),
    provenance: text(record, "provenance") ?? "model",
    ...(because.length === 0 ? {} : { because }),
  };
};

const supportOf: Parser = (record, base) => {
  const claim = text(record, "claim");
  const state = oneOf(SUPPORT_STATES, record["state"]);
  const by = oneOf(DECIDERS, record["by"]);
  if (claim === undefined || state === undefined || by === undefined) return undefined;
  const bands = bandsOf(record["bands"]);
  const anchors = anchorsOf(record["anchors"]);
  const exceptions = texts(record, "exceptions");
  return {
    type: "support",
    ...base,
    claim,
    state,
    by,
    ...optional(record, ["ref", "outcome", "to", "missing"]),
    ...(bands === undefined ? {} : { bands }),
    ...(anchors.length === 0 ? {} : { anchors }),
    ...(exceptions.length === 0 ? {} : { exceptions }),
  };
};

const resultOf: Parser = (record, base) => {
  const source = text(record, "source");
  const hash = text(record, "hash");
  if (source === undefined || hash === undefined) return undefined;
  const extra = optional(record, ["domain", "task", "research", "decision"]);
  return { type: "result", ...base, source, hash, claims: texts(record, "claims"), ...extra };
};

const horizonOf: Parser = (record, base) => {
  const kind = oneOf(HORIZON_KINDS, record["kind"]);
  const criterion = oneOf(CRITERION_KINDS, record["criterion"]) ?? "none";
  const state = oneOf(HORIZON_STATES, record["state"]);
  const helpText = text(record, "text");
  if (kind === undefined || state === undefined || helpText === undefined) return undefined;
  const extra = optional(record, ["answer", "task"]);
  return {
    type: "horizon",
    ...base,
    kind,
    text: helpText,
    criterion,
    domain: text(record, "domain") ?? "general",
    state,
    ...extra,
  };
};

const eventOf: Parser = (record, base) => {
  const claim = text(record, "claim");
  const cause = oneOf(EVENT_CAUSES, record["cause"]);
  const state = oneOf(EVENT_STATES, record["state"]);
  const support = oneOf(SUPPORT_STATES, record["support"]);
  if (claim === undefined || cause === undefined || state === undefined || support === undefined) return undefined;
  const bands = bandsOf(record["bands"]) ?? {};
  const fixed = optional(record, ["fixedBy"]);
  return { type: "event", ...base, claim, cause, state, support, bands, sources: texts(record, "sources"), ...fixed };
};

const number = (record: JsonObject, key: string): number => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const probeOf: Parser = (record, base) => {
  const claim = text(record, "claim");
  const form = oneOf(PROBE_FORMS, record["form"]);
  const prompt = text(record, "prompt");
  const keyHash = text(record, "keyHash");
  const options = texts(record, "options");
  const key = number(record, "key");
  if (claim === undefined || form === undefined || prompt === undefined || keyHash === undefined) return undefined;
  if (!Number.isInteger(key) || key < 0 || key >= options.length) return undefined;
  const extra = optional(record, ["decision", "task", "session"]);
  return {
    type: "probe",
    ...base,
    claim,
    concepts: texts(record, "concepts"),
    form,
    prompt,
    options,
    key,
    keyHash,
    ...extra,
  };
};

const PARSERS: Readonly<Record<string, Parser>> = {
  domain: (record, base) => ({ type: "domain", ...base, ...optional(record, ["parent"]) }),
  concept: conceptOf,
  evidence: evidenceOf,
  contest: (record, base) => {
    const target = text(record, "target");
    return target === undefined ? undefined : { type: "contest", ...base, target, ...optional(record, ["reason"]) };
  },
  claim: claimOf,
  support: supportOf,
  result: resultOf,
  horizon: horizonOf,
  signal: (record, base) => {
    const family = text(record, "family");
    return family === undefined
      ? undefined
      : {
          type: "signal",
          ...base,
          family,
          confidence: number(record, "confidence"),
          state: "shadow",
          ...optional(record, ["ref"]),
        };
  },
  event: eventOf,
  item: (record, base) => {
    const origin = text(record, "origin");
    const hash = text(record, "hash");
    if (origin === undefined || hash === undefined) return undefined;
    const instructions = number(record, "instructions");
    return { type: "item", ...base, origin, hash, instructions, synthesis: record["synthesis"] === true };
  },
  probe: probeOf,
  ask: (record, base) => {
    const fields = optional(record, ["task", "decision", "question", "criterion"]);
    const { task, decision, question, criterion } = fields;
    if (task === undefined || decision === undefined || question === undefined || criterion === undefined)
      return undefined;
    return { type: "ask", ...base, task, decision, question, criterion };
  },
};

export const parseEntry = (record: JsonObject): JudgeEntry | undefined => {
  const type = text(record, "type");
  const id = text(record, "id");
  const at = text(record, "at");
  const parser = type === undefined ? undefined : PARSERS[type];
  return parser === undefined || id === undefined || at === undefined ? undefined : parser(record, { id, at });
};
