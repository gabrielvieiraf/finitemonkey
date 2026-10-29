import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { accept, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";

export const PREREGISTRATION = "PREREGISTRATION.md";
export const PREREGISTRATION_LOCK = "PREREGISTRATION.lock.json";

export interface Freeze {
  readonly sha256: string;
  readonly frozenAt: string;
}

export const sha256 = (text: string): string =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n"), "utf8").digest("hex");

export const parseFreeze = (text: string): Parsed<Freeze> => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return reject(parsed.error);
  const { sha256: hash, frozenAt } = parsed.value;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return reject("sha256 must be 64 hex characters");
  if (typeof frozenAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(frozenAt)) return reject("frozenAt must be a date");
  return accept({ sha256: hash, frozenAt });
};

export const verifyFrozen = (benchDir: string): Parsed<Freeze> => {
  const freeze = parseFreeze(readFileSync(join(benchDir, PREREGISTRATION_LOCK), "utf8"));
  if (!freeze.ok) return reject(`${PREREGISTRATION_LOCK}: ${freeze.error}`);
  const actual = sha256(readFileSync(join(benchDir, PREREGISTRATION), "utf8"));
  if (actual !== freeze.value.sha256) {
    return reject(`${PREREGISTRATION} changed after it was frozen; record the change in DEVIATIONS.md instead`);
  }
  return freeze;
};

export const freezeText = (preregistration: string, frozenAt: string): string =>
  `${JSON.stringify({ sha256: sha256(preregistration), frozenAt }, null, 2)}\n`;

export const freeze = (benchDir: string, frozenAt: string): void => {
  const text = readFileSync(join(benchDir, PREREGISTRATION), "utf8");
  writeFileSync(join(benchDir, PREREGISTRATION_LOCK), freezeText(text, frozenAt));
};
