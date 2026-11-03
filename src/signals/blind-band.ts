import { bookConcepts, readBook } from "../conceitos/book.js";
import { type ConceptId, domainOf, profileDomainOf } from "../conceitos/concepts.js";
import { firstMentionedDomainConcept } from "../conceitos/mentions.js";
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
export const OPEN_BLIND_BAND_SCHEMA = "finitemonkey/blind-band@2";
export const CRITERIA = ["example", "property", "scenario", "check", "none"] as const;
export const HORIZON_SOURCES = ["skill", "clarify", "research", "divergence", "concept", "scope", "xray"] as const;
export const GENERAL = "general";

export type Criterion = (typeof CRITERIA)[number];
export type HorizonSource = (typeof HORIZON_SOURCES)[number];
export type BandDomain = Domain | typeof GENERAL;

export interface HorizonHelp {
  readonly source: HorizonSource;
  readonly criterion: Criterion;
  readonly domain: BandDomain;
  readonly field?: string;
  readonly task?: string;
  readonly file?: string;
  readonly approvedAt?: string;
}

export const bandDomainOf = (concept: ConceptId | undefined): BandDomain =>
  (concept === undefined ? undefined : profileDomainOf(concept)) ?? GENERAL;

export const domainOfText = (text: string): BandDomain => bandDomainOf(firstMentionedDomainConcept(text));

const FIELD = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const conceptDomain = (concept: ConceptId | undefined): Pick<HorizonHelp, "domain" | "field"> => {
  const domain = bandDomainOf(concept);
  const top = concept === undefined ? "" : domainOf(concept);
  return domain === GENERAL && FIELD.test(top) ? { domain, field: top } : { domain };
};

const KIND_CRITERION: Readonly<Partial<Record<CheckKind, Criterion>>> = {
  examples: "example",
  golden: "example",
  scenarios: "scenario",
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
    ...(help.field === undefined ? {} : { field: help.field }),
    ...(help.task === undefined ? {} : { task: help.task }),
    ...(help.file === undefined ? {} : { file: help.file }),
    ...(help.approvedAt === undefined ? {} : { approvedAt: help.approvedAt }),
  });

interface BandCounts {
  readonly week: string;
  readonly helps: number;
  readonly withoutCriterion: number;
  readonly index: number;
  readonly byCriterion: Readonly<Record<Criterion, number>>;
  readonly bySource: Readonly<Record<HorizonSource, number>>;
  readonly conceptsMoved: number;
}

export interface BandRow extends BandCounts {
  readonly domain: BandDomain;
}

export interface OpenBandRow extends BandCounts {
  readonly domain: string;
}

export interface BandTotal {
  readonly helps: number;
  readonly withoutCriterion: number;
  readonly index: number;
}

export interface BlindBandReport {
  readonly schema: typeof BLIND_BAND_SCHEMA;
  readonly rows: readonly BandRow[];
  readonly total: BandTotal;
}

export interface OpenBlindBandReport {
  readonly schema: typeof OPEN_BLIND_BAND_SCHEMA;
  readonly rows: readonly OpenBandRow[];
  readonly total: BandTotal;
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
  readonly field: string;
  readonly criterion: Criterion;
  readonly source: HorizonSource | undefined;
}

const bandDomain = (value: unknown): BandDomain => DOMAINS.find((domain) => domain === value) ?? GENERAL;

const parseLine = (line: string): Parsed | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok || parsed.value["event"] !== HORIZON_EVENT) return undefined;
  const at = parsed.value["at"];
  const week = typeof at === "string" ? isoWeek(at) : undefined;
  const criterion = CRITERIA.find((item) => item === parsed.value["criterion"]);
  if (week === undefined || criterion === undefined) return undefined;
  const source = HORIZON_SOURCES.find((item) => item === parsed.value["source"]);
  const domain = bandDomain(parsed.value["domain"]);
  const raw = parsed.value["field"];
  const field = typeof raw === "string" && FIELD.test(raw) ? raw : domain;
  return { week, domain, field, criterion, source };
};

const share = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000);

const emptyCounts = (): Record<Criterion, number> => ({ example: 0, property: 0, scenario: 0, check: 0, none: 0 });

const emptySources = (): Record<HorizonSource, number> => ({
  skill: 0,
  clarify: 0,
  research: 0,
  divergence: 0,
  concept: 0,
  scope: 0,
  xray: 0,
});

interface Group<D extends string> {
  readonly domain: D;
  readonly week: string;
  readonly counts: Record<Criterion, number>;
  readonly sources: Record<HorizonSource, number>;
}

const conceptWeeks = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  keyOf: (id: ConceptId) => string,
): ReadonlyMap<string, number> => {
  const moved = new Map<string, number>();
  const book = readBook(runtime, paths);
  for (const id of bookConcepts(book)) {
    const at = book.concepts[id]?.updatedAt;
    const week = at === undefined ? undefined : isoWeek(at);
    if (week === undefined) continue;
    const key = `${keyOf(id)}|${week}`;
    moved.set(key, (moved.get(key) ?? 0) + 1);
  }
  return moved;
};

const groupsOf = <D extends string>(logText: string, pick: (item: Parsed) => D): ReadonlyMap<string, Group<D>> => {
  const groups = new Map<string, Group<D>>();
  for (const line of logText.split("\n")) {
    const item = parseLine(line);
    if (item === undefined) continue;
    const domain = pick(item);
    const key = `${domain}|${item.week}`;
    const group = groups.get(key) ?? { domain, week: item.week, counts: emptyCounts(), sources: emptySources() };
    group.counts[item.criterion] += 1;
    if (item.source !== undefined) group.sources[item.source] += 1;
    groups.set(key, group);
  }
  return groups;
};

const rowsOf = <D extends string>(
  groups: ReadonlyMap<string, Group<D>>,
  moved: ReadonlyMap<string, number>,
): readonly (BandCounts & { readonly domain: D })[] =>
  [...groups.entries()]
    .map(([key, group]) => {
      const helps = CRITERIA.reduce((sum, criterion) => sum + group.counts[criterion], 0);
      return {
        domain: group.domain,
        week: group.week,
        helps,
        withoutCriterion: group.counts.none,
        index: share(group.counts.none, helps),
        byCriterion: { ...group.counts },
        bySource: { ...group.sources },
        conceptsMoved: moved.get(key) ?? 0,
      };
    })
    .sort((a, b) => a.week.localeCompare(b.week) || a.domain.localeCompare(b.domain));

const totalOf = (rows: readonly BandCounts[]): BandTotal => {
  const helps = rows.reduce((sum, row) => sum + row.helps, 0);
  const without = rows.reduce((sum, row) => sum + row.withoutCriterion, 0);
  return { helps, withoutCriterion: without, index: share(without, helps) };
};

export const blindBand = (runtime: Pick<Runtime, "readText">, paths: FmPaths, logText: string): BlindBandReport => {
  const rows = rowsOf(
    groupsOf(logText, (item) => item.domain),
    conceptWeeks(runtime, paths, bandDomainOf),
  );
  return { schema: BLIND_BAND_SCHEMA, rows, total: totalOf(rows) };
};

const openKey = (id: ConceptId): string => conceptDomain(id).field ?? bandDomainOf(id);

export const openBlindBand = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  logText: string,
): OpenBlindBandReport => {
  const rows = rowsOf(
    groupsOf(logText, (item) => item.field),
    conceptWeeks(runtime, paths, openKey),
  );
  return { schema: OPEN_BLIND_BAND_SCHEMA, rows, total: totalOf(rows) };
};
