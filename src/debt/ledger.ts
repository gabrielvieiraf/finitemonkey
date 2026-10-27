import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { Shortcut } from "../task/shortcuts.js";

export const DECISIONS_FILE = "decisions.jsonl";

export interface ShortcutRow extends Shortcut {
  readonly type: "shortcut";
  readonly task: string;
  readonly at: string;
}

export const decisionsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, "tasks", DECISIONS_FILE));

const optional = (record: Readonly<Record<string, unknown>>, key: string): Partial<Record<string, string>> =>
  typeof record[key] === "string" ? { [key]: record[key] } : {};

export const readShortcutRows = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ShortcutRow[] => {
  const text = runtime.readText(decisionsPath(paths));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const parsed = parseJsonObject(line);
    if (!parsed.ok || !isRecord(parsed.value)) return [];
    const { type, task, at, what } = parsed.value;
    if (type !== "shortcut" || typeof task !== "string" || typeof at !== "string" || typeof what !== "string")
      return [];
    return [
      {
        type,
        task,
        at,
        what,
        ...optional(parsed.value, "ceiling"),
        ...optional(parsed.value, "trigger"),
        ...optional(parsed.value, "where"),
      },
    ];
  });
};

export const recordShortcuts = (
  runtime: Runtime,
  paths: FmPaths,
  task: string,
  shortcuts: readonly Shortcut[],
): readonly ShortcutRow[] => {
  const known = new Set(readShortcutRows(runtime, paths).map((row) => `${row.task}\u0000${row.what}`));
  const rows = shortcuts
    .filter((item) => !known.has(`${task}\u0000${item.what}`))
    .map((item): ShortcutRow => ({ type: "shortcut", task, at: runtime.now(), ...item }));
  if (rows.length > 0) runtime.appendText(decisionsPath(paths), rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return rows;
};
