import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Vulnerability, VulnSeverity } from "./osv.js";

export const OSV_SEEN_FILE = ".finitemonkey/findings/osv.json";

const DAY_MS = 86_400_000;

export const DEADLINE_DAYS: Readonly<Record<VulnSeverity, number>> = {
  critical: 7,
  high: 14,
  medium: 30,
  low: 90,
  unknown: 30,
};

export type VulnVerdict = "block" | "warn";

export interface JudgedVuln extends Vulnerability {
  readonly verdict: VulnVerdict;
  readonly firstSeen: string;
  readonly deadline: string;
}

type Seen = Readonly<Record<string, string>>;

const keyOf = (vuln: Vulnerability): string => `${vuln.ecosystem}/${vuln.name}@${vuln.version}/${vuln.id}`;

export const readSeen = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): Seen => {
  const text = runtime.readText(toAbsolutePath(OSV_SEEN_FILE, root));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value["firstSeen"])) return {};
  return Object.fromEntries(
    Object.entries(parsed.value["firstSeen"]).flatMap(([key, value]): [string, string][] =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
};

export const writeSeen = (
  runtime: Pick<Runtime, "writeText">,
  root: AbsolutePath,
  judged: readonly JudgedVuln[],
): void => {
  const entries = judged.map((vuln): [string, string] => [keyOf(vuln), vuln.firstSeen]);
  const firstSeen: Readonly<Record<string, string>> = Object.fromEntries(
    entries.sort(([left], [right]) => left.localeCompare(right)),
  );
  runtime.writeText(
    toAbsolutePath(OSV_SEEN_FILE, root),
    `${JSON.stringify({ schemaVersion: 1, firstSeen }, null, 2)}\n`,
  );
};

export const judge = (vulns: readonly Vulnerability[], seen: Seen, now: string): readonly JudgedVuln[] => {
  const nowMs = Date.parse(now);
  return vulns.map((vuln) => {
    const firstSeen = seen[keyOf(vuln)] ?? now;
    const deadlineMs = Date.parse(firstSeen) + DEADLINE_DAYS[vuln.severity] * DAY_MS;
    const blocking = (vuln.severity === "critical" && vuln.fixed !== undefined) || nowMs > deadlineMs;
    return { ...vuln, verdict: blocking ? "block" : "warn", firstSeen, deadline: new Date(deadlineMs).toISOString() };
  });
};
