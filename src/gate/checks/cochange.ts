import { logEvent } from "../../evidence/log.js";
import {
  COCHANGE_FEATURE,
  type CochangeOptions,
  DEFAULT_OPTIONS,
  missingPartners,
  notDismissed,
  readDismissed,
} from "../../git/cochange.js";
import { historyOf } from "../../git/cochange-history.js";
import { configAt, loadProjectConfig } from "../../git/project-config.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 8;

const optionsOf = (ctx: GateContext): CochangeOptions => {
  const raw = configAt(loadProjectConfig(ctx.runtime, ctx.paths.root), "cochange", "half_life_days");
  const days = typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(days) && days > 0 ? { ...DEFAULT_OPTIONS, halfLifeDays: days } : DEFAULT_OPTIONS;
};

export const cochangeCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, COCHANGE_FEATURE);
  if (mode === "off") return passed([note("gate.cochange.off")]);
  const touched = ctx.changes.flatMap((change) => [
    change.path,
    ...(change.oldPath === undefined ? [] : [change.oldPath]),
  ]);
  const commits = historyOf(ctx.runtime, ctx.paths, ctx.git);
  const partners = notDismissed(
    missingPartners(commits, touched, optionsOf(ctx)),
    readDismissed(ctx.runtime, ctx.paths),
  );
  if (partners.length === 0) return passed([note("gate.cochange.ok", { count: commits.length })]);
  logEvent(ctx.runtime, ctx.paths, "cochange_warning", {
    task: ctx.contract.id,
    mode,
    pairs: partners.map((item) => `${item.file} -> ${item.partner}`),
  });
  const notes = partners.slice(0, MAX_LISTED).map((item) =>
    note("gate.cochange.partner", {
      file: item.file,
      partner: item.partner,
      support: item.support,
      confidence: Math.round(item.confidence * 100),
      commits: item.commits.map((hash) => hash.slice(0, 8)).join(", "),
    }),
  );
  return passed(mode === "shadow" ? [note("gate.cochange.shadow", { count: partners.length })] : notes);
};
