import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { isDetector, SLOP_DETECTORS, type SlopDetector, type SlopFinding } from "./types.js";

export const SLOP_FILE = "slop.json";
const MAX_SEEN = 500;

export interface Dismissal {
  readonly detector: SlopDetector;
  readonly fingerprint: string;
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly at: string;
}

export interface SlopStore {
  readonly seen: Readonly<Partial<Record<SlopDetector, readonly string[]>>>;
  readonly dismissed: readonly Dismissal[];
}

export interface DetectorRate {
  readonly detector: SlopDetector;
  readonly hits: number;
  readonly dismissed: number;
  readonly rate: number;
  readonly review: boolean;
}

export const REVIEW_RATE = 0.1;

export const fingerprintOf = (detector: SlopDetector, file: string, text: string): string =>
  sha256Hex(`${detector}\u0000${file}\u0000${text.trim().replace(/\s+/g, " ")}`).slice(0, 16);

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const dismissalOf = (value: unknown): Dismissal[] => {
  if (!isRecord(value)) return [];
  const { detector, fingerprint, file, line, reason, at } = value;
  if (typeof detector !== "string" || !isDetector(detector) || typeof fingerprint !== "string") return [];
  if (typeof file !== "string" || typeof line !== "number" || typeof at !== "string") return [];
  return [{ detector, fingerprint, file, line, reason: typeof reason === "string" ? reason : "", at }];
};

export const readSlopStore = (runtime: Pick<Runtime, "readText">, paths: FmPaths): SlopStore => {
  const raw = readJsonFile(runtime, paths.cache(SLOP_FILE));
  const seenRaw = raw?.["seen"];
  const seen = Object.fromEntries(
    SLOP_DETECTORS.map((detector) => [detector, strings(isRecord(seenRaw) ? seenRaw[detector] : undefined)]),
  );
  const dismissed = raw?.["dismissed"];
  return { seen, dismissed: Array.isArray(dismissed) ? dismissed.flatMap(dismissalOf) : [] };
};

export const writeSlopStore = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, store: SlopStore): boolean =>
  writeJsonFile(runtime, paths.cache(SLOP_FILE), { seen: { ...store.seen }, dismissed: [...store.dismissed] }).ok;

export const isDismissed = (store: SlopStore, item: SlopFinding): boolean => {
  const print = fingerprintOf(item.detector, item.file, item.text);
  return store.dismissed.some((entry) => entry.detector === item.detector && entry.fingerprint === print);
};

export const recordHits = (store: SlopStore, found: readonly SlopFinding[]): SlopStore => {
  const seen: Partial<Record<SlopDetector, readonly string[]>> = { ...store.seen };
  for (const item of found) {
    const list = seen[item.detector] ?? [];
    const print = fingerprintOf(item.detector, item.file, item.text);
    if (!list.includes(print)) seen[item.detector] = [...list, print].slice(-MAX_SEEN);
  }
  return { ...store, seen };
};

export const detectorRates = (store: SlopStore): readonly DetectorRate[] =>
  SLOP_DETECTORS.map((detector) => {
    const hits = new Set([
      ...(store.seen[detector] ?? []),
      ...store.dismissed.filter((d) => d.detector === detector).map((d) => d.fingerprint),
    ]).size;
    const dismissed = store.dismissed.filter((entry) => entry.detector === detector).length;
    const rate = hits === 0 ? 0 : dismissed / hits;
    return { detector, hits, dismissed, rate, review: rate > REVIEW_RATE };
  });
