import { addedByContent } from "../../core/line-diff.js";
import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import { baseText, changedPaths, guardMode, readWorking } from "../../quality/gate-sources.js";
import { loadTypescript } from "../../quality/ts-api.js";
import { analyzeSlop, type SlopFile } from "../../slop/analyze.js";
import { loadSlopConfig } from "../../slop/config.js";
import type { AddedLine } from "../../slop/lines.js";
import { isDismissed, readSlopStore, recordHits, writeSlopStore } from "../../slop/store.js";
import { levelOf, SLOP_GUARD, type SlopFinding } from "../../slop/types.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { EXCLUDE_FM, parseAddedLines } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 15;

const trackedAdditions = (ctx: GateContext): ReadonlyMap<string, readonly AddedLine[]> => {
  const diff = ctx.git.out(["diff", "-U0", "-M", "--no-color", "--no-ext-diff", ctx.base, "--", ".", EXCLUDE_FM]);
  const grouped = new Map<string, AddedLine[]>();
  for (const added of parseAddedLines(diff ?? "")) {
    grouped.set(added.path, [...(grouped.get(added.path) ?? []), { line: added.line, text: added.text }]);
  }
  return grouped;
};

const slopFiles = (ctx: GateContext): readonly SlopFile[] => {
  const tracked = trackedAdditions(ctx);
  return changedPaths(ctx).flatMap((file): SlopFile[] => {
    const text = readWorking(ctx, file);
    if (text === undefined) return [];
    const change = ctx.changes.find((item) => item.path === file);
    const created = change?.status === "A";
    const added = tracked.get(file) ?? (created ? addedByContent(baseText(ctx, file), text) : []);
    return [{ file, text, added, created }];
  });
};

const findingNote = (item: SlopFinding): Note =>
  note(`gate.slop.${item.detector}`, { file: item.file, line: item.line, detail: item.detail });

const countByDetector = (found: readonly SlopFinding[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const item of found) counts[item.detector] = (counts[item.detector] ?? 0) + 1;
  return counts;
};

export const slopCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, SLOP_GUARD);
  if (mode === "off") return passed([note("gate.slop.off")]);
  const files = slopFiles(ctx);
  const store = readSlopStore(ctx.runtime, ctx.paths);
  const found = analyzeSlop({
    files,
    exists: (file) => readWorking(ctx, file) !== undefined,
    config: loadSlopConfig(ctx.runtime, ctx.paths.root),
    ts: files.length === 0 ? undefined : loadTypescript(ctx.paths.root),
  }).filter((item) => !isDismissed(store, item));
  if (found.length > 0) {
    writeSlopStore(ctx.runtime, ctx.paths, recordHits(store, found));
    logEvent(ctx.runtime, ctx.paths, "slop.hits", { task: ctx.contract.id, mode, detectors: countByDetector(found) });
  }
  const blocks = found.filter((item) => levelOf(item.detector) === "block");
  const ordered = [...blocks, ...found.filter((item) => levelOf(item.detector) === "warn")];
  const notes = ordered.slice(0, MAX_LISTED).map(findingNote);
  if (blocks.length === 0) return passed([note("gate.slop.clean", { count: files.length }), ...notes]);
  if (mode === "shadow") return passed([note("gate.slop.shadow", { count: blocks.length }), ...notes]);
  return failed([...notes, note("gate.slop.fix")]);
};
