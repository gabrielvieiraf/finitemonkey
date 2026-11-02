import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";
import { type Behavior, parseBehavior } from "./bench-persona.js";

export const SIZES = ["S", "M", "L"] as const;
export const SOLUTIONS = ["right", "wrong", "alternative"] as const;
export const PARTITIONS = ["public", "heldout"] as const;
export const KINDS = ["code", "research"] as const;
export const BANDS = ["within", "edge", "beyond"] as const;
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const PERFIL_DOMAINS = ["product", "interface", "backend", "infrastructure", "security"] as const;

export type Size = (typeof SIZES)[number];
export type Solution = (typeof SOLUTIONS)[number];
export type Partition = (typeof PARTITIONS)[number];
export type Kind = (typeof KINDS)[number];
export type KnowledgeBand = (typeof BANDS)[number];
export type Level = (typeof LEVELS)[number];
export type PerfilDomain = (typeof PERFIL_DOMAINS)[number];

export interface Intents {
  readonly goal: string;
  readonly acceptance: string;
  readonly constraints: string;
}

export interface Family {
  readonly id: string;
  readonly dir: string;
  readonly size: Size;
  readonly language: string;
  readonly traps: readonly string[];
  readonly needsChange: boolean;
  readonly ambiguous: boolean;
  readonly intents: Intents;
  readonly vars: Readonly<Record<string, readonly string[]>>;
  readonly partition: Partition;
  readonly kind: Kind;
  readonly phase: string | undefined;
  readonly domains: readonly string[];
  readonly fmDomain: string | undefined;
  readonly fmConcepts: readonly string[];
  readonly trapSignals: readonly RegExp[];
}

export interface Persona {
  readonly id: string;
  readonly prompt: string;
  readonly behavior: Behavior;
  readonly record: JsonObject;
  readonly knowledge: Readonly<Record<string, KnowledgeBand>>;
  readonly selfReport: Readonly<Partial<Record<PerfilDomain, Level>>>;
}

const strings = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

const intentsOf = (raw: unknown): Intents | undefined => {
  if (!isRecord(raw)) return undefined;
  const { goal, acceptance, constraints } = raw;
  return typeof goal === "string" && typeof acceptance === "string" && typeof constraints === "string"
    ? { goal, acceptance, constraints }
    : undefined;
};

const varsOf = (raw: unknown): Readonly<Record<string, readonly string[]>> | undefined => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return undefined;
  const entries = Object.entries(raw).map(([name, options]) => [name, strings(options)] as const);
  if (entries.some(([, options]) => options === undefined || options.length === 0)) return undefined;
  return Object.fromEntries(entries.flatMap(([name, options]) => (options === undefined ? [] : [[name, options]])));
};

type Extras = Pick<Family, "kind" | "phase" | "domains" | "fmDomain" | "fmConcepts" | "trapSignals">;

const regexes = (raw: readonly string[]): readonly RegExp[] | undefined => {
  try {
    return raw.map((source) => new RegExp(source, "i"));
  } catch {
    return undefined;
  }
};

const familyExtras = (id: string, record: JsonObject): Parsed<Extras> => {
  const kind = record["kind"] === undefined ? "code" : KINDS.find((option) => option === record["kind"]);
  if (kind === undefined) return reject(`${id}: kind must be code or research`);
  const phase = record["phase"];
  if (phase !== undefined && typeof phase !== "string") return reject(`${id}: phase must be a string`);
  const fmDomain = record["fmDomain"];
  if (fmDomain !== undefined && typeof fmDomain !== "string") return reject(`${id}: fmDomain must be a string`);
  const domains = strings(record["domains"] ?? []);
  const fmConcepts = strings(record["fmConcepts"] ?? []);
  const signals = strings(record["trapSignals"] ?? []);
  if (domains === undefined || fmConcepts === undefined || signals === undefined) {
    return reject(`${id}: domains, fmConcepts and trapSignals must be lists of strings`);
  }
  const trapSignals = regexes(signals);
  if (trapSignals === undefined) return reject(`${id}: every trapSignals entry must be a valid pattern`);
  if (phase !== undefined && (domains.length === 0 || fmDomain === undefined || signals.length === 0)) {
    return reject(`${id}: a family of a phase needs domains, fmDomain and trapSignals`);
  }
  return accept({ kind, phase, domains, fmDomain, fmConcepts, trapSignals });
};

const knowledgeOf = (id: string, raw: unknown): Parsed<Readonly<Record<string, KnowledgeBand>>> => {
  if (raw === undefined) return accept({});
  if (!isRecord(raw)) return reject(`${id}: knowledge must map each domain to within, edge or beyond`);
  const entries: [string, KnowledgeBand][] = [];
  for (const [domain, band] of Object.entries(raw)) {
    const known = BANDS.find((option) => option === band);
    if (known === undefined) return reject(`${id}: knowledge of ${domain} must be within, edge or beyond`);
    entries.push([domain, known]);
  }
  return accept(Object.fromEntries(entries));
};

const selfReportOf = (id: string, raw: unknown): Parsed<Readonly<Partial<Record<PerfilDomain, Level>>>> => {
  if (raw === undefined) return accept({});
  if (!isRecord(raw)) return reject(`${id}: selfReport must map perfil domains to levels`);
  const entries: [PerfilDomain, Level][] = [];
  for (const [domain, level] of Object.entries(raw)) {
    const knownDomain = PERFIL_DOMAINS.find((option) => option === domain);
    const knownLevel = LEVELS.find((option) => option === level);
    if (knownDomain === undefined || knownLevel === undefined) {
      return reject(`${id}: selfReport ${domain} must be a perfil domain with a level of ${LEVELS.join(", ")}`);
    }
    entries.push([knownDomain, knownLevel]);
  }
  return accept(Object.fromEntries(entries));
};

export const parseFamily = (record: JsonObject, dir: string, partition: Partition): Parsed<Family> => {
  const { id, size, language, needsChange, ambiguous } = record;
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) return reject(`${dir}: id is required`);
  const knownSize = SIZES.find((option) => option === size);
  if (knownSize === undefined) return reject(`${id}: size must be S, M or L`);
  if (typeof language !== "string") return reject(`${id}: language is required`);
  if (typeof needsChange !== "boolean" || typeof ambiguous !== "boolean") {
    return reject(`${id}: needsChange and ambiguous must be true or false`);
  }
  const traps = strings(record["traps"]);
  const intents = intentsOf(record["intents"]);
  const vars = varsOf(record["vars"]);
  if (traps === undefined || intents === undefined || vars === undefined) {
    return reject(`${id}: traps, intents and vars must be well formed`);
  }
  const extra = familyExtras(id, record);
  if (!extra.ok) return extra;
  const missing = ["repo", "oracle", ...SOLUTIONS.map((name) => `solutions/${name}`)].filter(
    (part) => !existsSync(join(dir, part)),
  );
  if (missing.length > 0) return reject(`${id}: missing ${missing.join(", ")}`);
  return accept({
    id,
    dir,
    size: knownSize,
    language,
    traps,
    needsChange,
    ambiguous,
    intents,
    vars,
    partition,
    ...extra.value,
  });
};

const readJson = (path: string): Parsed<JsonObject> => parseJsonObject(readFileSync(path, "utf8"));

export const loadFamilies = (root: string, partition: Partition): Parsed<readonly Family[]> => {
  if (!existsSync(root)) return accept([]);
  const families: Family[] = [];
  for (const name of readdirSync(root).sort()) {
    const file = join(root, name, "task.json");
    if (!existsSync(file)) continue;
    const record = readJson(file);
    if (!record.ok) return reject(`${name}: ${record.error}`);
    const family = parseFamily(record.value, join(root, name), partition);
    if (!family.ok) return reject(family.error);
    families.push(family.value);
  }
  return accept(families);
};

export const loadPersonas = (root: string): Parsed<readonly Persona[]> => {
  const personas: Persona[] = [];
  for (const name of readdirSync(root)
    .filter((file) => file.endsWith(".json"))
    .sort()) {
    const record = readJson(join(root, name));
    if (!record.ok) return reject(`${name}: ${record.error}`);
    const { id, prompt } = record.value;
    if (typeof id !== "string" || typeof prompt !== "string") return reject(`${name}: id and prompt are required`);
    const behavior = parseBehavior(id, record.value);
    if (!behavior.ok) return reject(`${name}: ${behavior.error}`);
    const knowledge = knowledgeOf(id, record.value["knowledge"]);
    if (!knowledge.ok) return reject(`${name}: ${knowledge.error}`);
    const selfReport = selfReportOf(id, record.value["selfReport"]);
    if (!selfReport.ok) return reject(`${name}: ${selfReport.error}`);
    personas.push({
      id,
      prompt,
      behavior: behavior.value,
      record: record.value,
      knowledge: knowledge.value,
      selfReport: selfReport.value,
    });
  }
  return accept(personas);
};
