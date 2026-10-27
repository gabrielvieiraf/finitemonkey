import { matchesAny } from "../../core/glob.js";
import type { Note } from "../../evidence/types.js";
import { configAt, configList, loadProjectConfig } from "../../git/project-config.js";
import { projectPreset } from "../../prose/preset.js";
import { researchRecords } from "../../research/check.js";
import { addedDependencies } from "../../research/dependencies.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

const required = (ctx: GateContext): boolean =>
  projectPreset(ctx.runtime, ctx.paths.root) === "gabriel" ||
  configAt(loadProjectConfig(ctx.runtime, ctx.paths.root), "research", "required") === "true";

const findings = (ctx: GateContext): readonly Note[] => {
  const records = researchRecords(ctx.runtime, ctx.paths.root);
  const valid = records.filter((record) => record.issues.length === 0);
  const rulePaths = configList(loadProjectConfig(ctx.runtime, ctx.paths.root), "research", "rule_paths");
  const rules = rulePaths.length === 0 ? [] : ctx.changes.filter((change) => matchesAny(change.path, rulePaths));
  const backed = valid.some((record) => ctx.changes.some((change) => change.path === record.file));
  return [
    ...records.flatMap((record) =>
      record.issues.map((item) =>
        note(`research.issue.${item.kind}`, { detail: `${item.file}:${String(item.line)} ${item.detail}` }),
      ),
    ),
    ...addedDependencies(ctx)
      .filter((name) => !valid.some((record) => record.text.includes(name)))
      .map((name) => note("gate.research.dependency", { name })),
    ...(rules.length > 0 && !backed
      ? [
          note("gate.research.rule", {
            paths: rules
              .slice(0, 3)
              .map((change) => change.path)
              .join(", "),
          }),
        ]
      : []),
  ].slice(0, MAX_LISTED);
};

export const researchCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const notes = findings(ctx);
  if (notes.length === 0) return passed([note("gate.research.clean")]);
  return required(ctx) ? failed(notes) : passed([note("gate.research.warning_only"), ...notes]);
};
