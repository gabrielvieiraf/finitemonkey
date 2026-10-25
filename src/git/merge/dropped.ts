import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { accept, isRecord, optionalString, type Parsed, parseJson, reject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { normalizeLine } from "./lines.js";
import { DROPPED_REASONS, type DroppedItem, type Finding, type Side } from "./types.js";

export const DROPPED_FILE = ".finitemonkey/merge-dropped.json";

const REASONS: ReadonlySet<string> = new Set(DROPPED_REASONS);

const ALIASES: Readonly<Record<string, string>> = {
  same_intent_other_side: "mesma_intencao_outro_lado",
  reverted_on_purpose: "revertido_de_proposito",
  regenerated: "regenerado",
  moved_to: "movido_para",
  human_decision: "decisao_humana",
};

const sideOf = (value: string | undefined): Side | undefined =>
  value === "ours" || value === "theirs" ? value : undefined;

const itemOf = (value: unknown): DroppedItem | undefined => {
  if (!isRecord(value)) return undefined;
  const file = optionalString(value, "file");
  const reason = optionalString(value, "reason");
  if (file === undefined || reason === undefined) return undefined;
  return {
    file,
    side: sideOf(optionalString(value, "side")),
    text: optionalString(value, "line") ?? optionalString(value, "text") ?? optionalString(value, "symbol"),
    reason: ALIASES[reason] ?? reason,
    approvedBy: optionalString(value, "approved_by"),
  };
};

export interface DroppedList {
  readonly items: readonly DroppedItem[];
  readonly invalid: readonly Finding[];
}

const invalidFinding = (file: string, text: string): Finding => ({
  kind: "invalid-dropped",
  file,
  side: undefined,
  line: undefined,
  text,
  weak: false,
});

export const parseDropped = (text: string): Parsed<DroppedList> => {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  const list = isRecord(parsed.value) ? parsed.value["dropped"] : parsed.value;
  if (!Array.isArray(list)) return reject("expected a list of dropped items");
  const items: DroppedItem[] = [];
  const invalid: Finding[] = [];
  list.forEach((value: unknown, index) => {
    const item = itemOf(value);
    if (item === undefined) invalid.push(invalidFinding(DROPPED_FILE, `item ${String(index)}: needs file and reason`));
    else if (!REASONS.has(item.reason)) invalid.push(invalidFinding(item.file, `reason ${item.reason}`));
    else items.push(item);
  });
  return accept({ items, invalid });
};

export const loadDropped = (runtime: Runtime, root: AbsolutePath, file: string | undefined): Parsed<DroppedList> => {
  const path = toAbsolutePath(file ?? join(root, DROPPED_FILE), root);
  const text = runtime.readText(path);
  if (!text.ok) return file === undefined ? accept({ items: [], invalid: [] }) : reject(`${file}: ${text.error}`);
  return parseDropped(text.value);
};

export const isDropped = (finding: Finding, items: readonly DroppedItem[]): boolean =>
  items.some(
    (item) =>
      item.file === finding.file &&
      (item.side === undefined || finding.side === undefined || item.side === finding.side) &&
      (item.text === undefined || normalizeLine(item.text) === finding.text),
  );
