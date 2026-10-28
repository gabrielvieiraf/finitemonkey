import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";

export const BASELINE_FILE = ".finitemonkey/findings/baseline.json";
export const BASELINE_SCHEMA = "finitemonkey/findings-baseline@1";
export const LEGACY_SECRETS_SCHEMA = "finitemonkey/secrets-baseline@1";
export const BASELINE_STATES = ["aceito", "falso-positivo"] as const;
export const EXCEPTION_MAX_DAYS = 90;
export const SECRETS_CHECK = "secrets";

export type BaselineState = (typeof BASELINE_STATES)[number];

export interface Finding {
  readonly id: string;
  readonly check: string;
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly fingerprint: string;
}

export interface BaselineEntry {
  readonly check: string;
  readonly id: string;
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly fingerprint: string;
  readonly state: BaselineState;
  readonly owner: string;
  readonly reason: string;
  readonly acceptedAt: string;
  readonly expiresAt: string;
}

export interface Baseline {
  readonly schema: typeof BASELINE_SCHEMA;
  readonly entries: readonly BaselineEntry[];
}

export const EMPTY_BASELINE: Baseline = { schema: BASELINE_SCHEMA, entries: [] };

export const stableFindingId = (check: string, rule: string, file: string, fingerprint: string): string =>
  `${check}-${sha256Hex(`${check}\u0000${rule}\u0000${toPosixPath(file)}\u0000${fingerprint}`).slice(0, 16)}`;

export const baselinePath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, BASELINE_FILE));

const text = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const stateOf = (value: unknown): BaselineState | undefined => BASELINE_STATES.find((state) => state === value);

const parseEntry = (value: unknown): BaselineEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const fields = ["id", "rule", "file", "fingerprint", "owner", "reason", "acceptedAt", "expiresAt"] as const;
  const [id, rule, file, fingerprint, owner, reason, acceptedAt, expiresAt] = fields.map((key) => text(value, key));
  const state = stateOf(value["state"]);
  const line = value["line"];
  if (id === undefined || rule === undefined || file === undefined || fingerprint === undefined) return undefined;
  if (owner === undefined || reason === undefined || acceptedAt === undefined || expiresAt === undefined)
    return undefined;
  if (state === undefined || typeof line !== "number") return undefined;
  const check = text(value, "check") ?? SECRETS_CHECK;
  return { check, id, rule, file, line, fingerprint, state, owner, reason, acceptedAt, expiresAt };
};

export const parseBaseline = (raw: string): Parsed<Baseline> => {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const schema = parsed.value["schema"];
  if (schema !== BASELINE_SCHEMA && schema !== LEGACY_SECRETS_SCHEMA)
    return reject(`schema must be ${BASELINE_SCHEMA}`);
  const list = parsed.value["entries"];
  if (!Array.isArray(list)) return reject("entries must be a list");
  const entries: BaselineEntry[] = [];
  for (const [index, item] of list.entries()) {
    const entry = parseEntry(item);
    if (entry === undefined) return reject(`entry ${String(index)} is incomplete`);
    entries.push(entry);
  }
  return accept({ schema: BASELINE_SCHEMA, entries });
};

export const loadBaseline = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): Parsed<Baseline> => {
  const raw = runtime.readText(baselinePath(root));
  return raw.ok ? parseBaseline(raw.value) : accept(EMPTY_BASELINE);
};

export const serializeBaseline = (baseline: Baseline): string =>
  `${JSON.stringify(
    {
      schema: BASELINE_SCHEMA,
      entries: [...baseline.entries].sort((a, b) => a.check.localeCompare(b.check) || a.id.localeCompare(b.id)),
    },
    null,
    2,
  )}\n`;

export const saveBaseline = (runtime: Runtime, root: AbsolutePath, baseline: Baseline): Parsed<true> =>
  runtime.writeText(baselinePath(root), serializeBaseline(baseline));

export interface RatchetResult<F> {
  readonly fresh: readonly F[];
  readonly known: readonly F[];
  readonly expired: readonly F[];
  readonly fixed: readonly BaselineEntry[];
}

export type InScope = (file: string) => boolean;

export const ratchetFor = <F extends { readonly id: string }>(
  check: string,
  findings: readonly F[],
  baseline: Baseline,
  now: string,
  inScope: InScope | undefined,
): RatchetResult<F> => {
  const mine = baseline.entries.filter((entry) => entry.check === check);
  const byId = new Map(mine.map((entry) => [entry.id, entry]));
  const seen = new Set(findings.map((finding) => finding.id));
  const entryOf = (finding: F): BaselineEntry | undefined => byId.get(finding.id);
  return {
    fresh: findings.filter((finding) => entryOf(finding) === undefined),
    known: findings.filter((finding) => (entryOf(finding)?.expiresAt ?? "") >= now),
    expired: findings.filter((finding) => {
      const entry = entryOf(finding);
      return entry !== undefined && entry.expiresAt < now;
    }),
    fixed: inScope === undefined ? [] : mine.filter((entry) => !seen.has(entry.id) && inScope(entry.file)),
  };
};

export const withoutFixed = (baseline: Baseline, fixed: readonly BaselineEntry[]): Baseline => {
  const gone = new Set(fixed.map((entry) => `${entry.check}\u0000${entry.id}`));
  return {
    schema: BASELINE_SCHEMA,
    entries: baseline.entries.filter((entry) => !gone.has(`${entry.check}\u0000${entry.id}`)),
  };
};

export const withEntry = (baseline: Baseline, entry: BaselineEntry): Baseline => ({
  schema: BASELINE_SCHEMA,
  entries: [...baseline.entries.filter((item) => !(item.check === entry.check && item.id === entry.id)), entry],
});
