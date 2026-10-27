import type { PortRange, WorktreeEntry } from "./entry.js";

export const DEFAULT_PORT_BASE = 5174;
export const PORT_SPAN = 10;
const MAX_PORT = 65_535;

const overlaps = (left: PortRange, right: PortRange): boolean => left.from <= right.to && right.from <= left.to;

const LIVE: ReadonlySet<WorktreeEntry["status"]> = new Set(["active", "adopted", "done"]);

export const allocatePorts = (entries: readonly WorktreeEntry[], base: number): PortRange | undefined => {
  const taken = entries.flatMap((entry) => (entry.ports !== null && LIVE.has(entry.status) ? [entry.ports] : []));
  for (let from = base; from + PORT_SPAN - 1 <= MAX_PORT; from += PORT_SPAN) {
    const range = { from, to: from + PORT_SPAN - 1 };
    if (!taken.some((other) => overlaps(range, other))) return range;
  }
  return undefined;
};

export const portBaseOf = (raw: string | undefined): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < MAX_PORT ? parsed : DEFAULT_PORT_BASE;
};
