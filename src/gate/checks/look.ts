import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { matchesAny } from "../../core/glob.js";
import { isRecord, parseJsonObject } from "../../core/parsed.js";
import type { Note } from "../../evidence/types.js";
import { DEFAULT_SCREENS, loadLookConfig } from "../../look/config.js";
import { summaryPath } from "../../look/paths.js";
import { readLookReads } from "../../look/reads.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

interface SummaryView {
  readonly at: string;
  readonly captures: readonly string[];
  readonly blocking: readonly Note[];
  readonly ignored: readonly string[];
}

const findingNote = (value: unknown): readonly Note[] => {
  if (!isRecord(value) || value["blocking"] !== true) return [];
  const { rule, route, viewport, detail } = value;
  return [
    note("gate.look.finding", {
      rule: typeof rule === "string" ? rule : "",
      route: typeof route === "string" ? route : "",
      viewport: typeof viewport === "number" ? viewport : 0,
      detail: typeof detail === "string" ? detail : "",
    }),
  ];
};

const readSummary = (ctx: GateContext): SummaryView | undefined => {
  const text = ctx.runtime.readText(summaryPath(ctx.paths, ctx.treeHash));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (!parsed?.ok) return undefined;
  const { at, captures, findings, ignoredAllows } = parsed.value;
  if (typeof at !== "string" || !Array.isArray(captures) || !Array.isArray(findings)) return undefined;
  return {
    at,
    captures: captures.flatMap((item: unknown) =>
      isRecord(item) && typeof item["path"] === "string" ? [item["path"]] : [],
    ),
    blocking: findings.flatMap(findingNote),
    ignored: Array.isArray(ignoredAllows)
      ? ignoredAllows.filter((item): item is string => typeof item === "string")
      : [],
  };
};

const lastScreenEdit = (ctx: GateContext): number => {
  const screens = loadLookConfig(ctx.runtime, ctx.paths.root)?.screens ?? DEFAULT_SCREENS;
  return ctx.changes
    .filter((change) => change.status !== "D" && matchesAny(change.path, screens))
    .reduce((latest, change) => {
      const stat = ctx.runtime.stat(toAbsolutePath(join(ctx.paths.root, change.path)));
      return Math.max(latest, stat?.mtimeMs ?? 0);
    }, 0);
};

const unopened = (ctx: GateContext, captures: readonly string[]): readonly string[] => {
  const reads = readLookReads(ctx.runtime, ctx.paths);
  const edited = lastScreenEdit(ctx);
  return captures.filter((path) => {
    const at = reads[path];
    return at === undefined || Date.parse(at) < edited;
  });
};

export const lookCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const summary = readSummary(ctx);
  if (summary === undefined) return failed([note("gate.look.not_run")]);
  const ignored = summary.ignored.slice(0, MAX_LISTED).map((entry) => note("gate.look.allow_ignored", { entry }));
  if (summary.blocking.length > 0) return failed([...summary.blocking.slice(0, MAX_LISTED), ...ignored]);
  if (summary.captures.length === 0) return failed([note("gate.look.no_captures"), ...ignored]);
  const closed = unopened(ctx, summary.captures);
  if (closed.length > 0) {
    return failed([
      note("gate.look.unopened", { count: closed.length }),
      ...closed.slice(0, MAX_LISTED).map((file) => note("gate.look.open", { file })),
      ...ignored,
    ]);
  }
  return passed([note("gate.look.ok", { count: summary.captures.length }), ...ignored]);
};
