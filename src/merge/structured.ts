import { isRecord, type JsonObject, parseJson } from "../core/parsed.js";

export interface KeyConflict {
  readonly key: string;
}

export interface StructuredMerge {
  readonly text: string | undefined;
  readonly conflicts: readonly KeyConflict[];
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const MISSING = Symbol("missing");

type Slot = unknown;

const slot = (record: JsonObject | undefined, key: string): Slot =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : MISSING;

const mergeValue = (path: string, base: Slot, ours: Slot, theirs: Slot, conflicts: KeyConflict[]): Slot => {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  if (isRecord(ours) && isRecord(theirs)) {
    return mergeObject(path, isRecord(base) ? base : undefined, ours, theirs, conflicts);
  }
  conflicts.push({ key: path === "" ? "(root)" : path });
  return ours;
};

const mergeObject = (
  path: string,
  base: JsonObject | undefined,
  ours: JsonObject,
  theirs: JsonObject,
  conflicts: KeyConflict[],
): JsonObject => {
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const merged = mergeValue(
      path === "" ? key : `${path}.${key}`,
      slot(base, key),
      slot(ours, key),
      slot(theirs, key),
      conflicts,
    );
    if (merged !== MISSING) out[key] = merged;
  }
  return out;
};

const indentOf = (text: string): number | string => {
  const match = /\n([ \t]+)"/.exec(text);
  const unit = match?.[1] ?? "  ";
  return unit.startsWith("\t") ? "\t" : unit.length;
};

export const mergeJson = (base: string, ours: string, theirs: string): StructuredMerge | undefined => {
  const parsed = [base === "" ? { ok: true as const, value: {} } : parseJson(base), parseJson(ours), parseJson(theirs)];
  const [b, o, t] = parsed;
  if (b?.ok !== true || o?.ok !== true || t?.ok !== true) return undefined;
  const conflicts: KeyConflict[] = [];
  const merged = mergeValue("", b.value, o.value, t.value, conflicts);
  if (conflicts.length > 0 || merged === MISSING) return { text: undefined, conflicts };
  const newline = ours.endsWith("\n") ? "\n" : "";
  return { text: `${JSON.stringify(merged, null, indentOf(ours))}${newline}`, conflicts };
};

export const isStructured = (path: string): boolean => /\.json$/i.test(path);
