import type { InstructionFinding } from "./findings.js";
import type { LoadRecord } from "./log.js";
import type { Inventory } from "./types.js";

export interface LoadDiff {
  readonly session: string | undefined;
  readonly recorded: number;
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
}

export interface InstructionsMeasure {
  readonly sessions: number;
  readonly withConflict: number;
  readonly withVolatile: number;
}

export const keyOf = (path: string, platform: NodeJS.Platform): string =>
  platform === "win32" ? path.toLowerCase() : path;

const sessionsOf = (records: readonly LoadRecord[]): ReadonlyMap<string, readonly LoadRecord[]> => {
  const groups = new Map<string, LoadRecord[]>();
  for (const record of records) groups.set(record.session, [...(groups.get(record.session) ?? []), record]);
  return groups;
};

export const loadDiff = (
  inventory: Inventory,
  records: readonly LoadRecord[],
  platform: NodeJS.Platform,
  session?: string,
): LoadDiff => {
  const chosen = session ?? records.at(-1)?.session;
  const mine = records.filter((record) => record.session === chosen);
  if (chosen === undefined || mine.length === 0) return { session: chosen, recorded: 0, missing: [], unexpected: [] };
  const loaded = new Set(mine.map((record) => keyOf(record.file, platform)));
  const resolved = new Set(inventory.files.map((file) => keyOf(file.path, platform)));
  const display = new Map(inventory.files.map((file) => [keyOf(file.path, platform), file.display]));
  return {
    session: chosen,
    recorded: mine.length,
    missing: inventory.files
      .filter((file) => file.survivesCompaction && !loaded.has(keyOf(file.path, platform)))
      .map((file) => file.display),
    unexpected: [...new Set(mine.map((record) => record.file))]
      .filter((file) => !resolved.has(keyOf(file, platform)))
      .map((file) => display.get(keyOf(file, platform)) ?? file),
  };
};

const filesOf = (finding: InstructionFinding): readonly string[] => {
  switch (finding.kind) {
    case "conflict":
    case "duplicate":
      return [finding.first.file, finding.second.file];
    case "volatile":
      return [finding.at.file];
    case "oversized":
    case "shadowed":
      return [finding.file];
  }
};

export const instructionsMeasure = (
  inventory: Inventory,
  findings: readonly InstructionFinding[],
  records: readonly LoadRecord[],
  platform: NodeJS.Platform,
): InstructionsMeasure => {
  const pathOf = new Map(inventory.files.map((file) => [file.display, keyOf(file.path, platform)]));
  const keys = (kind: InstructionFinding["kind"]): readonly (readonly string[])[] =>
    findings
      .filter((finding) => finding.kind === kind)
      .map((finding) => filesOf(finding).map((file) => pathOf.get(file) ?? file));
  const conflicts = keys("conflict");
  const volatile = keys("volatile");
  const sessions = [...sessionsOf(records).values()].map(
    (list) => new Set(list.map((record) => keyOf(record.file, platform))),
  );
  return {
    sessions: sessions.length,
    withConflict: sessions.filter((loaded) => conflicts.some((files) => files.every((file) => loaded.has(file))))
      .length,
    withVolatile: sessions.filter((loaded) => volatile.some((files) => files.some((file) => loaded.has(file)))).length,
  };
};
