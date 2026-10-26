import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { callersRate, FLAGGED_EVENT, RELEASED_EVENT } from "../callers/rate.js";
import { type CallSite, callSites, removedSymbols } from "../callers/scan.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_SITES = 10;

const byName = (sites: readonly CallSite[]): ReadonlyMap<string, readonly CallSite[]> => {
  const grouped = new Map<string, CallSite[]>();
  for (const site of sites) grouped.set(site.name, [...(grouped.get(site.name) ?? []), site]);
  return grouped;
};

const siteNotes = (open: ReadonlyMap<string, readonly CallSite[]>): readonly Note[] => [
  ...[...open].map(([name, sites]) => note("gate.callers.open", { name, count: sites.length })),
  ...[...open.values()]
    .flat()
    .slice(0, MAX_SITES)
    .map((site) => note("gate.callers.at", { name: site.name, file: site.file, line: site.line })),
];

const record = (ctx: GateContext, event: string, names: readonly string[]): void => {
  if (names.length > 0) logEvent(ctx.runtime, ctx.paths, event, { task: ctx.contract.id, names: [...names] });
};

export const callersCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const symbols = removedSymbols(ctx.runtime, ctx.git, ctx.base, ctx.changes);
  const grouped = byName(callSites(ctx.runtime, ctx.git, symbols));
  const ignore = new Set(ctx.contract.callersIgnore ?? []);
  const open = new Map([...grouped].filter(([name]) => !ignore.has(name)));
  record(
    ctx,
    RELEASED_EVENT,
    [...grouped.keys()].filter((name) => ignore.has(name)),
  );
  record(ctx, FLAGGED_EVENT, [...open.keys()]);
  if (open.size === 0) return passed([note("gate.callers.none", { count: symbols.length })]);
  const rate = callersRate(ctx.runtime, ctx.paths);
  if (!rate.downgraded) return failed(siteNotes(open));
  return passed([
    note("gate.callers.warning", {
      percent: Math.round(rate.rate * 100),
      released: rate.released,
      total: rate.flagged,
    }),
    ...siteNotes(open),
  ]);
};
