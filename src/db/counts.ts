import { parseJsonObject } from "../core/parsed.js";

export type Counts = Readonly<Record<string, number>>;

export const parseCounts = (stdout: string): Counts => {
  const json = parseJsonObject(stdout.trim());
  if (json.ok) {
    return Object.fromEntries(
      Object.entries(json.value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  }
  return Object.fromEntries(
    stdout.split("\n").flatMap((line): [string, number][] => {
      const match = /^\s*([\w.-]+)\s*[:\s]\s*(\d+)\s*$/.exec(line);
      return match?.[1] === undefined || match[2] === undefined ? [] : [[match[1], Number(match[2])]];
    }),
  );
};

export interface RowDrop {
  readonly table: string;
  readonly before: number;
  readonly after: number;
}

export const rowDrops = (before: Counts, after: Counts): readonly RowDrop[] =>
  Object.entries(before).flatMap(([table, count]): RowDrop[] => {
    const now = after[table] ?? 0;
    return now < count ? [{ table, before: count, after: now }] : [];
  });
