import type { AbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Params } from "../i18n/translate.js";
import { ensureKey, type KeyStore, lineTrust, readKey, signLine } from "./sign.js";
import {
  COMPLETION_STATES,
  type Evidence,
  EVIDENCE_SCHEMA,
  EVIDENCE_STATUSES,
  type EvidenceInputs,
  type Note,
  UNVERIFIED_REASONS,
} from "./types.js";

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);

const params = (value: unknown): Params =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number",
        ),
      )
    : {};

const notes = (value: unknown): readonly Note[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) =>
        isRecord(item) && typeof item["key"] === "string" ? [{ key: item["key"], params: params(item["params"]) }] : [],
      )
    : [];

const text = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const strings = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

const inputsOf = (value: unknown): EvidenceInputs | undefined => {
  if (!isRecord(value) || typeof value["cwd"] !== "string") return undefined;
  return {
    cwd: value["cwd"],
    lockfiles: strings(value["lockfiles"]),
    tools: strings(value["tools"]),
    env: strings(value["env"]),
  };
};

const optional = (record: JsonObject): Partial<Evidence> => {
  const scripts = text(record, "scripts");
  const exitCode = record["exitCode"];
  const durationMs = record["durationMs"];
  const command = text(record, "command");
  const stdoutSha256 = text(record, "stdoutSha256");
  const releasedBy = text(record, "releasedBy");
  const reason = oneOf(UNVERIFIED_REASONS, record["reason"]);
  const failures = record["failures"];
  const testCount = record["testCount"];
  const state = oneOf(COMPLETION_STATES, record["state"]);
  const from = oneOf(COMPLETION_STATES, record["from"]);
  const stateReason = text(record, "stateReason");
  const inputs = inputsOf(record["inputs"]);
  return {
    ...(command === undefined ? {} : { command }),
    ...(typeof exitCode === "number" || exitCode === null ? { exitCode } : {}),
    ...(stdoutSha256 === undefined ? {} : { stdoutSha256 }),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(reason === undefined ? {} : { reason }),
    ...(releasedBy === undefined ? {} : { releasedBy }),
    ...(Array.isArray(failures)
      ? { failures: failures.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(typeof testCount === "number" ? { testCount } : {}),
    ...(state === undefined ? {} : { state }),
    ...(from === undefined ? {} : { from }),
    ...(stateReason === undefined ? {} : { stateReason }),
    ...(inputs === undefined ? {} : { inputs }),
    ...(scripts === undefined ? {} : { scripts }),
  };
};

export const parseEvidence = (line: string): Evidence | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok) return undefined;
  const record = parsed.value;
  const status = oneOf(EVIDENCE_STATUSES, record["status"]);
  const task = text(record, "task");
  const check = text(record, "check");
  const kind = text(record, "kind");
  const treeHash = text(record, "treeHash");
  const at = text(record, "at");
  if (record["schema"] !== EVIDENCE_SCHEMA || status === undefined) return undefined;
  if (task === undefined || check === undefined || kind === undefined || treeHash === undefined || at === undefined) {
    return undefined;
  }
  return {
    schema: EVIDENCE_SCHEMA,
    task,
    check,
    kind,
    status,
    treeHash,
    at,
    notes: notes(record["notes"]),
    ...optional(record),
  };
};

export interface CheckedLedger {
  readonly entries: readonly Evidence[];
  readonly tampered: number;
  readonly oldKey: number;
}

export type LedgerReader = Pick<Runtime, "readText" | "homeDir">;

export const readLedgerChecked = (runtime: LedgerReader, path: AbsolutePath): CheckedLedger => {
  const content = runtime.readText(path);
  if (!content.ok) return { entries: [], tampered: 0, oldKey: 0 };
  const key = readKey(runtime);
  const entries: Evidence[] = [];
  let tampered = 0;
  let oldKey = 0;
  for (const line of content.value.split("\n")) {
    if (line.trim() === "") continue;
    const trust = lineTrust(key, line);
    const entry = parseEvidence(line);
    if (trust === "old_key") oldKey += 1;
    else if (trust === "tampered") tampered += 1;
    else if (entry !== undefined) entries.push(entry);
  }
  return { entries, tampered, oldKey };
};

export const readLedger = (runtime: LedgerReader, path: AbsolutePath): readonly Evidence[] =>
  readLedgerChecked(runtime, path).entries;

export const appendEvidence = (
  runtime: Pick<Runtime, "appendText"> & KeyStore,
  path: AbsolutePath,
  entries: readonly Evidence[],
): boolean => {
  if (entries.length === 0) return true;
  const key = ensureKey(runtime);
  if (key === undefined) return false;
  return runtime.appendText(path, entries.map((entry) => `${signLine(key, { ...entry })}\n`).join("")).ok;
};

export const latestFor = (
  entries: readonly Evidence[],
  check: string,
  treeHash: string,
  command?: string,
): Evidence | undefined =>
  entries.findLast(
    (entry) =>
      entry.check === check && entry.treeHash === treeHash && (command === undefined || entry.command === command),
  );

export const hasStale = (entries: readonly Evidence[], check: string, treeHash: string): boolean =>
  entries.some((entry) => entry.check === check && entry.treeHash !== treeHash);
