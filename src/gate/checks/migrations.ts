import { DEFAULT_DEPLOY_BRANCH, loadDeployConfig } from "../../deploy/config.js";
import { changedMigrations, deployBase, lintChangedMigrations } from "../../deploy/migrations.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;
export const MIGRATIONS_FEATURE = "deploy-plan";

export const migrationsCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, MIGRATIONS_FEATURE);
  if (mode === "off") return passed([note("gate.migrations.off")]);
  const branch = loadDeployConfig(ctx.runtime, ctx.paths.root)?.branch ?? DEFAULT_DEPLOY_BRANCH;
  const files = changedMigrations(ctx.git, deployBase(ctx.git, branch));
  const issues = lintChangedMigrations(ctx.runtime, ctx.paths.root, files);
  if (issues.length === 0) return passed([note("gate.migrations.ok", { count: files.length })]);
  const notes = issues
    .slice(0, MAX_LISTED)
    .map((issue) => note(`gate.migrations.${issue.kind}`, { at: `${issue.file}:${String(issue.line)}` }));
  return mode === "shadow"
    ? passed([note("gate.migrations.shadow", { count: issues.length }), ...notes])
    : failed(notes);
};
