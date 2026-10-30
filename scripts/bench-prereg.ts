import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";
import { filesUnder } from "./bench-render.js";

export const PREREGISTRATION = "PREREGISTRATION.md";
export const PREREGISTRATION_LOCK = "PREREGISTRATION.lock.json";
export const PERSONAS_DIR = "personas";
export const TASKS_DIR = "tasks";
export const PHASES_DIR = "phases";

export interface Amendment {
  readonly at: string;
  readonly note: string;
  readonly changed: readonly string[];
}

export interface Freeze {
  readonly sha256: string;
  readonly frozenAt: string;
  readonly personas: Readonly<Record<string, string>>;
  readonly tasks?: Readonly<Record<string, string>>;
  readonly phases?: Readonly<Record<string, string>>;
  readonly amendments?: readonly Amendment[];
}

export const sha256 = (text: string): string =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n"), "utf8").digest("hex");

const hashMap = (raw: unknown): Readonly<Record<string, string>> | undefined => {
  if (!isRecord(raw)) return undefined;
  const entries = Object.entries(raw);
  if (!entries.every(([, value]) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))) return undefined;
  return Object.fromEntries(entries.flatMap(([file, value]) => (typeof value === "string" ? [[file, value]] : [])));
};

const SUM_LINE = /^([0-9a-f]{64}) {2}(\S+)$/;

const sumList = (raw: unknown): Readonly<Record<string, string>> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const entries: [string, string][] = [];
  for (const line of raw) {
    const match = typeof line === "string" ? SUM_LINE.exec(line) : null;
    if (match?.[1] === undefined || match[2] === undefined) return undefined;
    entries.push([match[2], match[1]]);
  }
  return Object.fromEntries(entries);
};

export const sumLines = (hashes: Readonly<Record<string, string>>): string[] =>
  Object.entries(hashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, hash]) => `${hash}  ${name}`);

const amendmentsOf = (raw: unknown): readonly Amendment[] | undefined => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  const out: Amendment[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return undefined;
    const { at, note, changed } = item;
    if (typeof at !== "string" || typeof note !== "string" || !Array.isArray(changed)) return undefined;
    out.push({ at, note, changed: changed.filter((entry): entry is string => typeof entry === "string") });
  }
  return out;
};

export const parseFreeze = (text: string): Parsed<Freeze> => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return reject(parsed.error);
  const { sha256: hash, frozenAt } = parsed.value;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return reject("sha256 must be 64 hex characters");
  if (typeof frozenAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(frozenAt)) return reject("frozenAt must be a date");
  const personas = hashMap(parsed.value["personas"]);
  if (personas === undefined) return reject("personas must map each persona file to its sha256");
  const tasks = parsed.value["tasks"] === undefined ? undefined : sumList(parsed.value["tasks"]);
  const phases = parsed.value["phases"] === undefined ? undefined : sumList(parsed.value["phases"]);
  if (
    (parsed.value["tasks"] !== undefined && tasks === undefined) ||
    (parsed.value["phases"] !== undefined && phases === undefined)
  ) {
    return reject('tasks and phases must list one "<sha256>  <name>" line per family or phase file');
  }
  const amendments = amendmentsOf(parsed.value["amendments"]);
  if (amendments === undefined) return reject("amendments must list { at, note, changed }");
  return accept({
    sha256: hash,
    frozenAt,
    personas,
    ...(tasks === undefined ? {} : { tasks }),
    ...(phases === undefined ? {} : { phases }),
    ...(amendments.length === 0 ? {} : { amendments }),
  });
};

export const personaHashes = (benchDir: string): Readonly<Record<string, string>> => {
  const dir = join(benchDir, PERSONAS_DIR);
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => [file, sha256(readFileSync(join(dir, file), "utf8"))]),
  );
};

const treeHash = (dir: string): string =>
  sha256(
    filesUnder(dir)
      .map((file) => `${file}\n${readFileSync(join(dir, file), "utf8")}\n`)
      .join(""),
  );

export const taskHashes = (benchDir: string): Readonly<Record<string, string>> => {
  const dir = join(benchDir, TASKS_DIR);
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => existsSync(join(dir, name, "task.json")))
      .sort()
      .map((name) => [name, treeHash(join(dir, name))]),
  );
};

export const phaseHashes = (benchDir: string): Readonly<Record<string, string>> => {
  const dir = join(benchDir, PHASES_DIR);
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => [file, sha256(readFileSync(join(dir, file), "utf8"))]),
  );
};

const sameHashes = (left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean =>
  JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());

export const verifyFrozen = (benchDir: string): Parsed<Freeze> => {
  const freeze = parseFreeze(readFileSync(join(benchDir, PREREGISTRATION_LOCK), "utf8"));
  if (!freeze.ok) return reject(`${PREREGISTRATION_LOCK}: ${freeze.error}`);
  const actual = sha256(readFileSync(join(benchDir, PREREGISTRATION), "utf8"));
  if (actual !== freeze.value.sha256) {
    return reject(`${PREREGISTRATION} changed after it was frozen; record the change in DEVIATIONS.md instead`);
  }
  if (!sameHashes(freeze.value.personas, personaHashes(benchDir))) {
    return reject(`the persona files changed after the freeze; record the change in DEVIATIONS.md instead`);
  }
  if (freeze.value.tasks !== undefined && !sameHashes(freeze.value.tasks, taskHashes(benchDir))) {
    return reject(`the task families changed after the freeze; record the change in DEVIATIONS.md instead`);
  }
  if (freeze.value.phases !== undefined && !sameHashes(freeze.value.phases, phaseHashes(benchDir))) {
    return reject(`the phase files changed after the freeze; record the change in DEVIATIONS.md instead`);
  }
  return freeze;
};

export const freezeText = (
  preregistration: string,
  frozenAt: string,
  personas: Readonly<Record<string, string>>,
): string => `${JSON.stringify({ sha256: sha256(preregistration), frozenAt, personas }, null, 2)}\n`;

export const freeze = (benchDir: string, frozenAt: string): void => {
  const text = readFileSync(join(benchDir, PREREGISTRATION), "utf8");
  writeFileSync(join(benchDir, PREREGISTRATION_LOCK), freezeText(text, frozenAt, personaHashes(benchDir)));
};

const changedKeys = (
  prefix: string,
  before: Readonly<Record<string, string>> | undefined,
  after: Readonly<Record<string, string>>,
): readonly string[] =>
  Object.entries(after)
    .filter(([key, hash]) => before?.[key] !== hash)
    .map(([key]) => `${prefix}/${key}`);

export const amend = (benchDir: string, at: string, note: string): Parsed<Amendment> => {
  const lockFile = join(benchDir, PREREGISTRATION_LOCK);
  const current = parseFreeze(readFileSync(lockFile, "utf8"));
  if (!current.ok) return reject(current.error);
  if (sha256(readFileSync(join(benchDir, PREREGISTRATION), "utf8")) !== current.value.sha256) {
    return reject(`${PREREGISTRATION} itself changed; an amendment never covers the frozen text`);
  }
  const personas = personaHashes(benchDir);
  const tasks = taskHashes(benchDir);
  const phases = phaseHashes(benchDir);
  const changed = [
    ...changedKeys(PERSONAS_DIR, current.value.personas, personas),
    ...changedKeys(TASKS_DIR, current.value.tasks, tasks),
    ...changedKeys(PHASES_DIR, current.value.phases, phases),
  ];
  if (changed.length === 0) return reject("nothing changed since the last freeze or amendment");
  const amendment: Amendment = { at, note, changed };
  const next: JsonObject = {
    sha256: current.value.sha256,
    frozenAt: current.value.frozenAt,
    personas,
    tasks: sumLines(tasks),
    phases: sumLines(phases),
    amendments: [...(current.value.amendments ?? []), amendment].map((item) => ({
      at: item.at,
      note: item.note,
      changed: [...item.changed],
    })),
  };
  writeFileSync(lockFile, `${JSON.stringify(next, null, 2)}\n`);
  return accept(amendment);
};
