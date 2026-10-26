import type { Ctx } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { type ApplyFailure, applyPlan } from "../install/apply.js";
import { GITIGNORE_FILE, SETTINGS_FILE, VENDOR_BIN, VENDOR_PACKAGE } from "../install/layout.js";
import { buildPlan, CHANGING, detect, type PlanError, readPreviousLock } from "../install/plan.js";
import { openProject, planInputFor } from "../install/session.js";

export const FIXABLE_FILES = [SETTINGS_FILE, GITIGNORE_FILE, VENDOR_BIN, VENDOR_PACKAGE] as const;

export interface Fixed {
  readonly installed: boolean;
  readonly written: readonly string[];
  readonly backup: string | undefined;
}

export type FixError =
  { readonly kind: "plan"; readonly error: PlanError } | { readonly kind: "apply"; readonly error: ApplyFailure };

const fixable: readonly string[] = FIXABLE_FILES;

export const applyFixes = (ctx: Ctx, write: boolean): Parsed<Fixed, FixError> => {
  const { project, gitRoot } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return reject({ kind: "plan", error: previous.error });
  if (previous.value === undefined) return accept({ installed: false, written: [], backup: undefined });
  const input = planInputFor(ctx, previous.value.preset, undefined, false);
  const plan = buildPlan(project, detect(project, gitRoot, input), input, previous.value);
  if (!plan.ok) return reject({ kind: "plan", error: plan.error });
  const pending = plan.value.items.filter((item) => CHANGING.includes(item.action) && fixable.includes(item.path));
  if (pending.length === 0 || !write) {
    return accept({ installed: true, written: pending.map((item) => item.path), backup: undefined });
  }
  const applied = applyPlan(project, plan.value, ctx.version, fixable);
  if (!applied.ok) return reject({ kind: "apply", error: applied.error });
  return accept({ installed: true, written: applied.value.written, backup: applied.value.backup });
};
