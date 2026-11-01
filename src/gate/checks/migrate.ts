import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { destructiveStatements, hasRollbackPlan } from "../../db/destructive.js";
import { appliedEdits, lockRisks } from "../../db/locks.js";
import { readStats, sizesFor, touchedTables } from "../../db/stats.js";
import {
  isLocalDatabase,
  type MigrateConfig,
  migrateConfig,
  runThrowaway,
  type ThrowawayResult,
} from "../../db/throwaway.js";
import { MIGRATION_FILE } from "../../deploy/migrations.js";
import type { Note } from "../../evidence/types.js";
import { loadProjectConfig } from "../../git/project-config.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { removeScratch, scratchDir } from "../isolated.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

export const MIGRATE_FEATURE = "migrate-check";
const MAX_LISTED = 12;

interface MigrationText {
  readonly file: string;
  readonly text: string;
}

const throwaway = (ctx: GateContext, config: MigrateConfig): ThrowawayResult => {
  if (config.url === undefined || config.apply === undefined) return { kind: "not_configured" };
  if (!isLocalDatabase(config.url)) return { kind: "refused", url: config.url };
  if (!ctx.trusted) return { kind: "unavailable", step: "trust", detail: ctx.contract.id };
  const dir = scratchDir(ctx.runtime, ctx.paths.root, "migrate");
  const added = ctx.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, ctx.base], ctx.paths.root, {});
  if (!added.ok) return { kind: "unavailable", step: "worktree", detail: added.stderr.trim() };
  try {
    return runThrowaway(ctx.runtime, config, { root: ctx.paths.root, base: dir }, ctx.deadline);
  } finally {
    removeScratch(ctx.runtime, ctx.paths.root, dir);
  }
};

const migrationTexts = (ctx: GateContext): readonly MigrationText[] =>
  ctx.changes
    .filter((change) => change.status !== "D" && MIGRATION_FILE.test(change.path))
    .flatMap((change) => {
      const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, change.path)));
      return text.ok ? [{ file: change.path, text: text.value }] : [];
    });

const staticNotes = (ctx: GateContext, config: MigrateConfig, texts: readonly MigrationText[]): readonly Note[] => {
  const { engine } = config;
  const edits = appliedEdits(ctx.changes).map((edit) => note(`gate.migrate.${edit.kind}`, { at: edit.file }));
  const locks = texts
    .flatMap((item) => lockRisks(item.file, item.text, engine))
    .map((risk) => note(`gate.migrate.lock.${risk.kind}`, { at: `${risk.file}:${String(risk.line)}`, engine }));
  return [...edits, ...locks];
};

const destructiveNotes = (ctx: GateContext, texts: readonly MigrationText[]) => {
  const criteria = ctx.contract.acceptance.map((check) => `${check.id} ${check.description ?? ""}`);
  const statements = texts.flatMap((item) => destructiveStatements(item.file, item.text));
  const params = (statement: (typeof statements)[number]) => ({
    at: `${statement.file}:${String(statement.line)}`,
    subject: statement.subject,
  });
  return {
    held: statements
      .filter((statement) => !hasRollbackPlan(criteria, statement))
      .map((statement) => note(`gate.migrate.destructive.${statement.kind}`, params(statement))),
    planned: statements
      .filter((statement) => hasRollbackPlan(criteria, statement))
      .map((statement) => note("gate.migrate.rollback_planned", params(statement))),
  };
};

const statsNotes = (ctx: GateContext, config: MigrateConfig, texts: readonly MigrationText[]): readonly Note[] => {
  if (config.stats === undefined || texts.length === 0) return [];
  const stats = readStats(ctx.runtime, ctx.paths.root, config.stats);
  if (!stats.ok) return [note("gate.migrate.stats_unreadable", { file: config.stats })];
  return sizesFor(
    stats,
    texts.flatMap((item) => touchedTables(item.text)),
  ).map((size) => note("gate.migrate.table_size", { table: size.table, rows: size.rows }));
};

const throwawayNotes = (result: ThrowawayResult): readonly Note[] => {
  switch (result.kind) {
    case "not_configured":
      return [];
    case "refused":
      return [note("gate.migrate.refused", { url: result.url.replace(/\/\/[^@/]*@/, "//***@") })];
    case "unavailable":
      return [];
    case "ran":
      return [
        ...result.findings.map((finding) => note(`gate.migrate.${finding}`)),
        ...result.rows.map((row) => note("gate.migrate.rows-dropped", { ...row })),
      ];
  }
};

export const migrateCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, MIGRATE_FEATURE);
  if (mode === "off") return passed([note("gate.migrate.off")]);
  const touched = ctx.changes.some((change) => MIGRATION_FILE.test(change.oldPath ?? change.path));
  if (!touched) return passed([note("gate.migrate.none")]);
  const config = migrateConfig(loadProjectConfig(ctx.runtime, ctx.paths.root));
  const texts = migrationTexts(ctx);
  const result = throwaway(ctx, config);
  const destructive = destructiveNotes(ctx, texts);
  const info = [...destructive.planned, ...statsNotes(ctx, config, texts)];
  const findings = [...staticNotes(ctx, config, texts), ...destructive.held, ...throwawayNotes(result)].slice(
    0,
    MAX_LISTED,
  );
  if (findings.length === 0 && result.kind === "unavailable") {
    return unverified("tool_missing", [
      note("gate.migrate.unavailable", { step: result.step, detail: result.detail }),
      ...info,
    ]);
  }
  if (findings.length === 0) {
    return passed([note(result.kind === "ran" ? "gate.migrate.ok" : "gate.migrate.static_ok"), ...info]);
  }
  return mode === "shadow"
    ? passed([note("gate.migrate.shadow", { count: findings.length }), ...findings, ...info])
    : failed([...findings, ...info]);
};
