import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { appliedEdits, lockRisks } from "../../db/locks.js";
import { isLocalDatabase, migrateConfig, runThrowaway, type ThrowawayResult } from "../../db/throwaway.js";
import { MIGRATION_FILE } from "../../deploy/migrations.js";
import type { Note } from "../../evidence/types.js";
import { loadProjectConfig } from "../../git/project-config.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { removeScratch, scratchDir } from "../isolated.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

export const MIGRATE_FEATURE = "migrate-check";
const MAX_LISTED = 12;

const throwaway = (ctx: GateContext): ThrowawayResult => {
  const config = migrateConfig(loadProjectConfig(ctx.runtime, ctx.paths.root));
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

const staticNotes = (ctx: GateContext): readonly Note[] => {
  const engine = migrateConfig(loadProjectConfig(ctx.runtime, ctx.paths.root)).engine;
  const edits = appliedEdits(ctx.changes).map((edit) => note(`gate.migrate.${edit.kind}`, { at: edit.file }));
  const locks = ctx.changes
    .filter((change) => change.status !== "D" && MIGRATION_FILE.test(change.path))
    .flatMap((change) => {
      const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, change.path)));
      return text.ok ? lockRisks(change.path, text.value, engine) : [];
    })
    .map((risk) => note(`gate.migrate.lock.${risk.kind}`, { at: `${risk.file}:${String(risk.line)}`, engine }));
  return [...edits, ...locks];
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
      return result.findings.map((finding) => note(`gate.migrate.${finding}`));
  }
};

export const migrateCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, MIGRATE_FEATURE);
  if (mode === "off") return passed([note("gate.migrate.off")]);
  const touched = ctx.changes.some((change) => MIGRATION_FILE.test(change.oldPath ?? change.path));
  if (!touched) return passed([note("gate.migrate.none")]);
  const result = throwaway(ctx);
  const findings = [...staticNotes(ctx), ...throwawayNotes(result)].slice(0, MAX_LISTED);
  if (findings.length === 0 && result.kind === "unavailable") {
    return unverified("tool_missing", [note("gate.migrate.unavailable", { step: result.step, detail: result.detail })]);
  }
  if (findings.length === 0) {
    return passed([note(result.kind === "ran" ? "gate.migrate.ok" : "gate.migrate.static_ok")]);
  }
  return mode === "shadow"
    ? passed([note("gate.migrate.shadow", { count: findings.length }), ...findings])
    : failed(findings);
};
