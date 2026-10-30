import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";
import { type Behavior, parseBehavior } from "./bench-persona.js";

export const SIZES = ["S", "M", "L"] as const;
export const SOLUTIONS = ["right", "wrong", "alternative"] as const;
export const PARTITIONS = ["public", "heldout"] as const;

export type Size = (typeof SIZES)[number];
export type Solution = (typeof SOLUTIONS)[number];
export type Partition = (typeof PARTITIONS)[number];

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
}

export interface Persona {
  readonly id: string;
  readonly prompt: string;
  readonly behavior: Behavior;
  readonly record: JsonObject;
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
  const missing = ["repo", "oracle", ...SOLUTIONS.map((name) => `solutions/${name}`)].filter(
    (part) => !existsSync(join(dir, part)),
  );
  if (missing.length > 0) return reject(`${id}: missing ${missing.join(", ")}`);
  return accept({ id, dir, size: knownSize, language, traps, needsChange, ambiguous, intents, vars, partition });
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
    personas.push({ id, prompt, behavior: behavior.value, record: record.value });
  }
  return accept(personas);
};
