import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { nowMs } from "../../core/clock.js";
import type { Note } from "../../evidence/types.js";
import { activeGrant } from "../../guards/release/grants.js";
import type { TestViolation } from "../../guards/tests/analyze.js";
import { isProtectedConfig, isTestFile } from "../../guards/tests/patterns.js";
import { analyzeTree } from "../../guards/tests/tree.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { fileAt } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";
import { runShellCheck } from "./command.js";

const MAX_LISTED = 10;

export const violationNote = (violation: TestViolation): Note =>
  note(`gate.tests.${violation.kind}`, {
    file: violation.path,
    before: violation.before ?? 0,
    after: violation.after ?? 0,
  });

export const treeViolations = (ctx: GateContext): readonly TestViolation[] => {
  const relevant = ctx.changes.filter(
    (change) => isTestFile(change.path) || isTestFile(change.oldPath ?? "") || isProtectedConfig(change.path),
  );
  return analyzeTree({
    changes: relevant,
    before: (path) => fileAt(ctx.git, ctx.base, path),
    after: (path) => {
      const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, path)));
      return text.ok ? text.value : undefined;
    },
    acceptedConfigs: ctx.trust.configs,
    scopePaths: ctx.contract.scope.paths,
    testsProtected: ctx.contract.scope.testsProtected,
  });
};

export const testsCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const violations = treeViolations(ctx);
  const grant =
    violations.length === 0
      ? undefined
      : activeGrant(ctx.runtime, ctx.paths, "tests", nowMs(ctx.runtime), ctx.sessionId);
  const notes = violations.slice(0, MAX_LISTED).map(violationNote);
  if (violations.length > 0 && grant === undefined) return failed([...notes, note("gate.tests.fix")]);
  const released = grant === undefined ? {} : { releasedBy: `person@${grant.grantedAt}` };
  const releaseNotes =
    grant === undefined ? [] : [...notes, note("gate.note.released", { guard: "tests", reason: grant.reason })];
  if (check.run === undefined) return { ...passed([note("gate.tests.clean"), ...releaseNotes]), ...released };
  const outcome = runShellCheck(check, check.run, ctx);
  return { ...outcome, notes: [...outcome.notes, ...releaseNotes], ...released };
};
