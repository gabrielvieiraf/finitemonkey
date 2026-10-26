import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import type { HookHandlerJson } from "./hook-entries.js";
import { LOCK_SCHEMA, type Preset, PRESETS } from "./layout.js";
import type { SettingsAdded } from "./settings-merge.js";

export const ENTRY_KINDS = ["settings", "gitignore", "generated", "markdown"] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface LockEntry {
  readonly path: string;
  readonly kind: EntryKind;
  readonly existed: boolean;
  readonly hash: string;
  readonly backup?: string;
  readonly added?: SettingsAdded;
  readonly handlers?: readonly HookHandlerJson[];
}

export interface LockFile {
  readonly schema: typeof LOCK_SCHEMA;
  readonly version: string;
  readonly preset: Preset;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly createdDirs: readonly string[];
  readonly entries: readonly LockEntry[];
}

const strings = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

const parseAdded = (value: unknown): SettingsAdded | undefined => {
  if (!isRecord(value)) return undefined;
  const deny = strings(value["deny"]);
  const { schema, attribution } = value;
  if (deny === undefined || typeof schema !== "boolean" || typeof attribution !== "boolean") return undefined;
  const ask = strings(value["ask"]) ?? [];
  const blockReads = value["blockReads"] === true;
  const marketplace = value["marketplace"] === true;
  const plugin = value["plugin"] === true;
  const language = value["language"];
  const added = { schema, attribution, deny, ask, blockReads, marketplace, plugin };
  return typeof language === "string" ? { ...added, language } : added;
};

const parseEntry = (value: unknown): LockEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, kind, existed, hash, backup } = value;
  const known = ENTRY_KINDS.find((item) => item === kind);
  if (typeof path !== "string" || known === undefined || typeof existed !== "boolean" || typeof hash !== "string") {
    return undefined;
  }
  const added = parseAdded(value["added"]);
  const handlers = Array.isArray(value["handlers"]) ? value["handlers"].filter(isRecord) : undefined;
  return {
    path,
    kind: known,
    existed,
    hash,
    ...(typeof backup === "string" ? { backup } : {}),
    ...(added === undefined ? {} : { added }),
    ...(handlers === undefined ? {} : { handlers }),
  };
};

const parseEntries = (value: unknown): readonly LockEntry[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(parseEntry);
  return entries.every((entry) => entry !== undefined) ? entries : undefined;
};

const fromRecord = (record: JsonObject): Parsed<LockFile> => {
  const { schema, version, preset, installedAt, updatedAt } = record;
  const known = PRESETS.find((item) => item === preset);
  const entries = parseEntries(record["entries"]);
  const createdDirs = strings(record["createdDirs"]);
  if (schema !== LOCK_SCHEMA) return reject(`schema is not ${LOCK_SCHEMA}`);
  if (typeof version !== "string" || typeof installedAt !== "string" || typeof updatedAt !== "string") {
    return reject("version, installedAt and updatedAt must be text");
  }
  if (known === undefined || entries === undefined || createdDirs === undefined) {
    return reject("preset, entries or createdDirs is malformed");
  }
  return accept({ schema, version, preset: known, installedAt, updatedAt, createdDirs, entries });
};

export const parseLock = (text: string): Parsed<LockFile> => {
  const parsed = parseJsonObject(text);
  return parsed.ok ? fromRecord(parsed.value) : reject(parsed.error);
};

export const renderLock = (lock: LockFile): string => `${JSON.stringify(lock, null, 2)}\n`;
