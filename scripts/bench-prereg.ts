import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";

export const PREREGISTRATION = "PREREGISTRATION.md";
export const PREREGISTRATION_LOCK = "PREREGISTRATION.lock.json";
export const PERSONAS_DIR = "personas";

export interface Freeze {
  readonly sha256: string;
  readonly frozenAt: string;
  readonly personas: Readonly<Record<string, string>>;
}

export const sha256 = (text: string): string =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n"), "utf8").digest("hex");

export const parseFreeze = (text: string): Parsed<Freeze> => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return reject(parsed.error);
  const { sha256: hash, frozenAt } = parsed.value;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return reject("sha256 must be 64 hex characters");
  if (typeof frozenAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(frozenAt)) return reject("frozenAt must be a date");
  const personas = parsed.value["personas"];
  if (!isRecord(personas)) return reject("personas must map each persona file to its sha256");
  const entries = Object.entries(personas);
  if (!entries.every(([, value]) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))) {
    return reject("personas must map each persona file to its sha256");
  }
  return accept({
    sha256: hash,
    frozenAt,
    personas: Object.fromEntries(
      entries.flatMap(([file, value]) => (typeof value === "string" ? [[file, value]] : [])),
    ),
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
