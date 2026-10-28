import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const SIGNALS_FILE = "signals.jsonl";
export const INDEX_FILE = "signals-index.json";
export const PROFILE_FILE = "signals-profile.json";

const KEEP_LINES = 1000;
const ROTATE_AT = 1500;

export interface SignalFiles {
  readonly log: AbsolutePath;
  readonly index: AbsolutePath;
  readonly profile: AbsolutePath;
}

export const signalFiles = (paths: FmPaths): SignalFiles => ({
  log: toAbsolutePath(join(paths.dir, SIGNALS_FILE)),
  index: toAbsolutePath(join(paths.dir, INDEX_FILE)),
  profile: toAbsolutePath(join(paths.dir, PROFILE_FILE)),
});

interface EntryBase {
  readonly at: string;
  readonly session: string;
  readonly turn: number;
}

export type SignalEntry =
  | (EntryBase & { readonly kind: "error"; readonly sig: string; readonly sample: string; readonly tool: string })
  | (EntryBase & { readonly kind: "edit"; readonly file: string; readonly hash: string; readonly undo: boolean })
  | (EntryBase & { readonly kind: "prompt"; readonly fp: readonly string[]; readonly progress: string })
  | (EntryBase & { readonly kind: "permission"; readonly key: string })
  | (EntryBase & {
      readonly kind: "approved";
      readonly file: string;
      readonly lines: number;
      readonly ms: number;
      readonly fast: boolean;
    })
  | (EntryBase & { readonly kind: "research"; readonly agent: string })
  | (EntryBase & { readonly kind: "release"; readonly sig: string })
  | (EntryBase & { readonly kind: "fourth"; readonly sig: string; readonly mode: string });

export type SignalKind = SignalEntry["kind"];

const text = (raw: JsonObject, key: string): string => {
  const value = raw[key];
  return typeof value === "string" ? value : "";
};

const count = (raw: JsonObject, key: string): number => {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const parseEntry = (raw: JsonObject): SignalEntry | undefined => {
  const base = { at: text(raw, "at"), session: text(raw, "session"), turn: count(raw, "turn") };
  switch (raw["kind"]) {
    case "error":
      return { ...base, kind: "error", sig: text(raw, "sig"), sample: text(raw, "sample"), tool: text(raw, "tool") };
    case "edit":
      return { ...base, kind: "edit", file: text(raw, "file"), hash: text(raw, "hash"), undo: raw["undo"] === true };
    case "prompt":
      return { ...base, kind: "prompt", fp: strings(raw["fp"]), progress: text(raw, "progress") };
    case "permission":
      return { ...base, kind: "permission", key: text(raw, "key") };
    case "approved":
      return {
        ...base,
        kind: "approved",
        file: text(raw, "file"),
        lines: count(raw, "lines"),
        ms: count(raw, "ms"),
        fast: raw["fast"] === true,
      };
    case "research":
      return { ...base, kind: "research", agent: text(raw, "agent") };
    case "release":
      return { ...base, kind: "release", sig: text(raw, "sig") };
    case "fourth":
      return { ...base, kind: "fourth", sig: text(raw, "sig"), mode: text(raw, "mode") };
    default:
      return undefined;
  }
};

const parseLine = (line: string): SignalEntry | undefined => {
  const parsed = parseJsonObject(line);
  return parsed.ok ? parseEntry(parsed.value) : undefined;
};

export const readEntries = (runtime: Pick<Runtime, "readText">, files: SignalFiles): readonly SignalEntry[] => {
  const raw = runtime.readText(files.log);
  if (!raw.ok) return [];
  return raw.value.split("\n").flatMap((line) => {
    const entry = line.trim() === "" ? undefined : parseLine(line);
    return entry === undefined ? [] : [entry];
  });
};

export const appendEntry = (
  runtime: Pick<Runtime, "readText" | "writeText" | "appendText">,
  files: SignalFiles,
  entry: SignalEntry,
  before: readonly SignalEntry[],
): readonly SignalEntry[] => {
  const after = [...before, entry];
  if (after.length >= ROTATE_AT) {
    const kept = after.slice(-KEEP_LINES);
    runtime.writeText(
      files.log,
      kept
        .map((item) => JSON.stringify(item))
        .join("\n")
        .concat("\n"),
    );
    return kept;
  }
  runtime.appendText(files.log, `${JSON.stringify(entry)}\n`);
  return after;
};

export const sessionEntries = (entries: readonly SignalEntry[], session: string): readonly SignalEntry[] =>
  entries.filter((entry) => entry.session === session);

export const turnOf = (entries: readonly SignalEntry[], session: string): number =>
  sessionEntries(entries, session).filter((entry) => entry.kind === "prompt").length;

export interface SignalProfile {
  readonly threshold: number;
  readonly notLoop: number;
}

export const DEFAULT_THRESHOLD = 3;
export const MAX_THRESHOLD = 10;

export const readProfile = (runtime: Pick<Runtime, "readText">, files: SignalFiles): SignalProfile => {
  const raw = readJsonFile(runtime, files.profile);
  const threshold = raw?.["threshold"];
  const notLoop = raw?.["notLoop"];
  return {
    threshold:
      typeof threshold === "number" && Number.isInteger(threshold) && threshold >= DEFAULT_THRESHOLD
        ? Math.min(threshold, MAX_THRESHOLD)
        : DEFAULT_THRESHOLD,
    notLoop: typeof notLoop === "number" && Number.isInteger(notLoop) && notLoop > 0 ? notLoop : 0,
  };
};

export const writeProfile = (
  runtime: Pick<Runtime, "writeText">,
  files: SignalFiles,
  profile: SignalProfile,
): boolean => writeJsonFile(runtime, files.profile, { threshold: profile.threshold, notLoop: profile.notLoop }).ok;

export const readIndexFile = (runtime: Pick<Runtime, "readText">, files: SignalFiles): JsonObject =>
  readJsonFile(runtime, files.index) ?? {};

export const recordOf = (value: unknown): JsonObject => (isRecord(value) ? value : {});
