import { readBook } from "../conceitos/book.js";
import { CONCEPT_IDS, conceptsIn, domainOf } from "../conceitos/concepts.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { type Domain, DOMAINS } from "../perfil/types.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readState, readTrust } from "../task/state.js";
import type { AcceptanceCheck, CheckKind } from "../task/types.js";

export const HORIZON_EVENT = "horizon.help";
export const BLIND_BAND_SCHEMA = "finitemonkey/blind-band@1";
export const CRITERIA = ["example", "property", "scenario", "check", "none"] as const;
export const HORIZON_SOURCES = ["skill", "clarify", "research", "divergence", "concept", "scope"] as const;
export const GENERAL = "general";

export type Criterion = (typeof CRITERIA)[number];
export type HorizonSource = (typeof HORIZON_SOURCES)[number];
export type BandDomain = Domain | typeof GENERAL;

export interface HorizonHelp {
  readonly source: HorizonSource;
  readonly criterion: Criterion;
  readonly domain: BandDomain;
  readonly task?: string;
}

export const domainOfText = (text: string): BandDomain => {
  const first = conceptsIn(text)[0];
  return first === undefined ? GENERAL : domainOf(first);
};

const KIND_CRITERION: Readonly<Partial<Record<CheckKind, Criterion>>> = {
  examples: "example",
  golden: "example",
};

export const criterionOfCheck = (check: AcceptanceCheck | undefined): Criterion =>
  check === undefined ? "none" : (KIND_CRITERION[check.kind] ?? "check");

export const activeCheckOf = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  kind: CheckKind,
): { readonly task: string | undefined; readonly check: AcceptanceCheck | undefined } => {
  const task = readState(runtime, paths).active;
  const text = task === undefined ? undefined : readTrust(runtime, paths).approved[task];
  const parsed = task === undefined || text === undefined ? undefined : parseContract(task, text);
  return { task, check: parsed?.ok === true ? parsed.value.acceptance.find((item) => item.kind === kind) : undefined };
};

export const recordHorizon = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  help: HorizonHelp,
): boolean =>
  logEvent(runtime, paths, HORIZON_EVENT, {
    source: help.source,
    criterion: help.criterion,
    domain: help.domain,
    ...(help.task === undefined ? {} : { task: help.task }),
  });

export interface BandRow {
  readonly domain: BandDomain;
  readonly week: string;
  readonly helps: number;
  readonly withoutCriterion: number;
  readonly index: number;
  readonly byCriterion: Readonly<Record<Criterion, number>>;
  readonly conceptsMoved: number;
}

export interface BlindBandReport {
  readonly schema: typeof BLIND_BAND_SCHEMA;
  readonly rows: readonly BandRow[];
  readonly total: { readonly helps: number; readonly withoutCriterion: number; readonly index: number };
}

export const isoWeek = (at: string): string | undefined => {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return undefined;
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / (7 * 86_400_000)) + 1;
  return `${String(thursday.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
};

interface Parsed {
  readonly week: string;
  readonly domain: BandDomain;
  readonly criterion: Criterion;
}

const bandDomain = (value: unknown): BandDomain => DOMAINS.find((domain) => domain === value) ?? GENERAL;

const parseLine = (line: string): Parsed | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok || parsed.value["event"] !== HORIZON_EVENT) return undefined;
  const at = parsed.value["at"];
  const week = typeof at === "string" ? isoWeek(at) : undefined;
  const criterion = CRITERIA.find((item) => item === parsed.value["criterion"]);
  if (week === undefined || criterion === undefined) return undefined;
  return { week, domain: bandDomain(parsed.value["domain"]), criterion };
};

const share = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000);

const emptyCounts = (): Record<Criterion, number> => ({ example: 0, property: 0, scenario: 0, check: 0, none: 0 });

const conceptWeeks = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlyMap<string, number> => {
  const moved = new Map<string, number>();
  const book = readBook(runtime, paths);
  for (const id of CONCEPT_IDS) {
    const at = book.concepts[id]?.updatedAt;
    const week = at === undefined ? undefined : isoWeek(at);
    if (week === undefined) continue;
    const key = `${domainOf(id)}|${week}`;
    moved.set(key, (moved.get(key) ?? 0) + 1);
  }
  return moved;
};

export const blindBand = (runtime: Pick<Runtime, "readText">, paths: FmPaths, logText: string): BlindBandReport => {
  const groups = new Map<string, { domain: BandDomain; week: string; counts: Record<Criterion, number> }>();
  for (const line of logText.split("\n")) {
    const item = parseLine(line);
    if (item === undefined) continue;
    const key = `${item.domain}|${item.week}`;
    const group = groups.get(key) ?? { domain: item.domain, week: item.week, counts: emptyCounts() };
    group.counts[item.criterion] += 1;
    groups.set(key, group);
  }
  const moved = conceptWeeks(runtime, paths);
  const rows = [...groups.entries()]
    .map(([key, group]): BandRow => {
      const helps = CRITERIA.reduce((sum, criterion) => sum + group.counts[criterion], 0);
      return {
        domain: group.domain,
        week: group.week,
        helps,
        withoutCriterion: group.counts.none,
        index: share(group.counts.none, helps),
        byCriterion: { ...group.counts },
        conceptsMoved: moved.get(key) ?? 0,
      };
    })
    .sort((a, b) => a.week.localeCompare(b.week) || a.domain.localeCompare(b.domain));
  const helps = rows.reduce((sum, row) => sum + row.helps, 0);
  const without = rows.reduce((sum, row) => sum + row.withoutCriterion, 0);
  return { schema: BLIND_BAND_SCHEMA, rows, total: { helps, withoutCriterion: without, index: share(without, helps) } };
};
