import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { appendEvidence } from "../evidence/ledger.js";
import { EVIDENCE_SCHEMA } from "../evidence/types.js";
import {
  type Baseline,
  EMPTY_BASELINE,
  type Finding,
  loadBaseline,
  ratchetFor,
  saveBaseline,
  stableFindingId,
  withoutFixed,
} from "../findings/baseline.js";
import { isMuted, readBudget, recordFiring } from "../policy/budget.js";
import type { GuardMode } from "../policy/policy.js";
import { loadPolicy } from "../policy/policy.js";
import { IMPLICIT_ID } from "../task/implicit.js";
import { activeTaskId } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { LOOK_DIR, lookDir } from "./paths.js";
import type { LookFinding } from "./types.js";
import type { UxIssue, UxPage } from "./ux.js";

export const UX_FILE = "ux.json";
export const UX_SCHEMA = "finitemonkey/look-ux@1";

export interface UxRecord {
  readonly id: string;
  readonly check: string;
  readonly rule: string;
  readonly route: string;
  readonly viewport: number;
  readonly selector: string;
  readonly detail: string;
  readonly unverified: boolean;
  readonly blocking: boolean;
  readonly baseline: boolean;
}

export interface RuleCount {
  readonly check: string;
  readonly rule: string;
  readonly count: number;
  readonly unverified: number;
  readonly fired: number;
  readonly dismissed: number;
}

export interface UxFile {
  readonly schema: typeof UX_SCHEMA;
  readonly treeHash: string;
  readonly at: string;
  readonly rules: readonly RuleCount[];
  readonly records: readonly UxRecord[];
}

export const fingerprintOf = (viewport: number, selector: string): string => `${String(viewport)} ${selector}`;

export const uxFindingId = (check: string, rule: string, route: string, viewport: number, selector: string): string =>
  stableFindingId(check, rule, route, fingerprintOf(viewport, selector));

const asFinding = (record: UxRecord): Finding => ({
  id: record.id,
  check: record.check,
  rule: record.rule,
  file: record.route,
  line: record.viewport,
  fingerprint: fingerprintOf(record.viewport, record.selector),
});

export interface Governed {
  readonly findings: readonly LookFinding[];
  readonly records: readonly UxRecord[];
  readonly fixed: Baseline | undefined;
}

export interface GovernInput {
  readonly pages: readonly UxPage[];
  readonly modes: Readonly<Record<string, GuardMode>>;
  readonly baseline: Baseline;
  readonly now: string;
  readonly muted: (rule: string) => boolean;
}

const blocks = (issue: UxIssue, mode: GuardMode, known: boolean, muted: boolean): boolean =>
  mode === "active" && issue.unverified !== true && issue.advisory !== true && !known && !muted;

interface Entry {
  readonly page: UxPage;
  readonly item: UxIssue;
  readonly id: string;
}

interface Ratcheted {
  readonly known: ReadonlySet<string>;
  readonly baseline: Baseline;
  readonly changed: boolean;
}

const ratchetAll = (entries: readonly Entry[], live: readonly UxPage[], input: GovernInput): Ratcheted => {
  const known = new Set<string>();
  let baseline = input.baseline;
  let changed = false;
  for (const check of [...new Set(live.map((page) => page.feature))]) {
    const mine = entries
      .filter((entry) => entry.page.feature === check && entry.item.unverified !== true)
      .map((entry) => ({
        id: entry.id,
        check,
        rule: entry.item.rule,
        file: entry.page.route,
        line: entry.page.viewport,
        fingerprint: fingerprintOf(entry.page.viewport, entry.item.selector),
      }));
    const routes = new Set(live.filter((page) => page.feature === check).map((page) => page.route));
    const result = ratchetFor(check, mine, baseline, input.now, (file) => routes.has(file));
    for (const finding of result.known) known.add(finding.id);
    if (result.fixed.length > 0) {
      baseline = withoutFixed(baseline, result.fixed);
      changed = true;
    }
  }
  return { known, baseline, changed };
};

const outputOf = (
  { page, item, id }: Entry,
  input: GovernInput,
  known: boolean,
): { readonly record: UxRecord; readonly finding: LookFinding } => {
  const blocking = blocks(item, input.modes[page.feature] ?? "off", known, input.muted(item.rule));
  const unverified = item.unverified === true;
  const where = { route: page.route, viewport: page.viewport, selector: item.selector };
  return {
    record: {
      id,
      check: page.feature,
      rule: item.rule,
      ...where,
      detail: item.detail,
      unverified,
      blocking,
      baseline: known,
    },
    finding: {
      rule: item.rule,
      ...where,
      detail: unverified ? `not verified: ${item.detail}` : item.detail,
      blocking,
      feature: page.feature,
      id,
      ...(unverified ? { unverified: true as const } : {}),
      ...(known ? { baseline: true as const } : {}),
    },
  };
};

export const governUx = (input: GovernInput): Governed => {
  const live = input.pages.filter((page) => (input.modes[page.feature] ?? "off") !== "off");
  const entries = live.flatMap((page) =>
    page.issues.map((item) => ({
      page,
      item,
      id: uxFindingId(page.feature, item.rule, page.route, page.viewport, item.selector),
    })),
  );
  const ratcheted = ratchetAll(entries, live, input);
  const out = entries.map((entry) => outputOf(entry, input, ratcheted.known.has(entry.id)));
  return {
    findings: out.map((entry) => entry.finding),
    records: out.map((entry) => entry.record),
    fixed: ratcheted.changed ? ratcheted.baseline : undefined,
  };
};

const uxPath = (paths: FmPaths, tree: string): AbsolutePath => toAbsolutePath(join(lookDir(paths, tree), UX_FILE));

const counted = (
  records: readonly UxRecord[],
  fired: (rule: string) => readonly [number, number],
): readonly RuleCount[] => {
  const keys = [...new Set(records.map((record) => `${record.check}\u0000${record.rule}`))].sort();
  return keys.map((key) => {
    const [check = "", rule = ""] = key.split("\u0000");
    const mine = records.filter((record) => record.check === check && record.rule === rule);
    const [firings, dismissed] = fired(rule);
    return {
      check,
      rule,
      count: mine.filter((record) => !record.unverified).length,
      unverified: mine.filter((record) => record.unverified).length,
      fired: firings,
      dismissed,
    };
  });
};

export interface GovernContext {
  readonly runtime: Runtime;
  readonly paths: FmPaths;
  readonly tree: string;
  readonly modes: Readonly<Record<string, GuardMode>>;
}

const recordEvidence = (ctx: GovernContext, file: UxFile): void => {
  const { runtime, paths } = ctx;
  const task = activeTaskId(runtime, paths) ?? IMPLICIT_ID;
  const checks = [...new Set(file.records.map((record) => record.check))];
  appendEvidence(
    runtime,
    paths.evidence(task),
    checks.map((check) => ({
      schema: EVIDENCE_SCHEMA,
      task,
      check: `*${check}*`,
      kind: check,
      status: file.records.some((record) => record.check === check && record.blocking)
        ? ("failed" as const)
        : ("passed" as const),
      treeHash: ctx.tree,
      at: file.at,
      notes: file.rules
        .filter((row) => row.check === check)
        .map((row) => ({
          key: "ux.recorded",
          params: { rule: row.rule, count: row.count, unverified: row.unverified },
        })),
    })),
  );
};

export const governAndRecord = (ctx: GovernContext, pages: readonly UxPage[]): readonly LookFinding[] => {
  const { runtime, paths, tree } = ctx;
  if (pages.length === 0) return [];
  const loaded = loadBaseline(runtime, paths.root);
  const baseline = loaded.ok ? loaded.value : EMPTY_BASELINE;
  const policy = loadPolicy(runtime, paths.root);
  const verified = pages.flatMap((page) => page.issues.filter((item) => item.unverified !== true));
  for (const rule of new Set(verified.map((item) => item.rule))) recordFiring(runtime, paths, rule);
  const budget = readBudget(runtime, paths);
  const now = runtime.now();
  const governed = governUx({
    pages,
    modes: ctx.modes,
    baseline,
    now,
    muted: (rule) => isMuted(budget, policy.alertBudget, Date.parse(now), rule),
  });
  if (governed.fixed !== undefined && loaded.ok) saveBaseline(runtime, paths.root, governed.fixed);
  const file: UxFile = {
    schema: UX_SCHEMA,
    treeHash: tree,
    at: now,
    rules: counted(governed.records, (rule) => [budget[rule]?.fired.length ?? 0, budget[rule]?.dismissed.length ?? 0]),
    records: governed.records,
  };
  runtime.writeText(uxPath(paths, tree), `${JSON.stringify(file, null, 2)}\n`);
  if (file.records.length > 0) recordEvidence(ctx, file);
  return governed.findings;
};

const recordOf = (value: unknown): UxRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, check, rule, route, viewport, selector, detail } = value;
  if (typeof id !== "string" || typeof check !== "string" || typeof rule !== "string") return undefined;
  if (typeof route !== "string" || typeof viewport !== "number" || typeof selector !== "string") return undefined;
  return {
    id,
    check,
    rule,
    route,
    viewport,
    selector,
    detail: typeof detail === "string" ? detail : "",
    unverified: value["unverified"] === true,
    blocking: value["blocking"] === true,
    baseline: value["baseline"] === true,
  };
};

export const readUxFile = (runtime: Pick<Runtime, "readText">, file: AbsolutePath): readonly UxRecord[] => {
  const text = runtime.readText(file);
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const list = parsed?.ok === true ? parsed.value["records"] : undefined;
  return Array.isArray(list) ? list.flatMap((item: unknown) => recordOf(item) ?? []) : [];
};

export const latestUxRecords = (
  runtime: Pick<Runtime, "readText" | "listDir" | "stat">,
  paths: FmPaths,
): readonly UxRecord[] => {
  const dirs = runtime.listDir(toAbsolutePath(join(paths.dir, LOOK_DIR)));
  if (!dirs.ok) return [];
  const newest = dirs.value
    .map((name) => toAbsolutePath(join(paths.dir, LOOK_DIR, name, UX_FILE)))
    .map((file) => ({ file, at: runtime.stat(file)?.mtimeMs ?? -1 }))
    .filter((entry) => entry.at >= 0)
    .sort((left, right) => right.at - left.at)[0];
  return newest === undefined ? [] : readUxFile(runtime, newest.file);
};

export const uxFindingsOf = (records: readonly UxRecord[]): readonly Finding[] =>
  records.filter((record) => !record.unverified).map(asFinding);
