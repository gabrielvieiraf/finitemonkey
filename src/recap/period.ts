const UNIT_MS: Readonly<Record<string, number>> = { h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const RELATIVE = /^(\d{1,4})([hdw])$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/;

export const DEFAULT_SINCE = "7d";

export const sinceIso = (value: string, now: string): string | undefined => {
  const relative = RELATIVE.exec(value.trim());
  if (relative !== null) {
    const ms = Number(relative[1]) * (UNIT_MS[relative[2] ?? "d"] ?? 0);
    return new Date(Date.parse(now) - ms).toISOString();
  }
  if (!DATE.test(value.trim())) return undefined;
  const at = Date.parse(value.trim());
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
};
