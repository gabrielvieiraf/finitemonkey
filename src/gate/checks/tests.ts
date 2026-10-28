import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { nowMs } from "../../core/clock.js";
import { addedByContent } from "../../core/line-diff.js";
import type { Note } from "../../evidence/types.js";
import { activeGrant } from "../../guards/release/grants.js";
import type { TestViolation } from "../../guards/tests/analyze.js";
import { astCounter, type TestCounter } from "../../guards/tests/ast-count.js";
import { isListed, TESTS_HOLD_GUARD } from "../../guards/tests/hold.js";
import { isProtectedConfig, isSnapshot, isTestFile, testLanguage } from "../../guards/tests/patterns.js";
import { analyzeTree } from "../../guards/tests/tree.js";
import { guardMode } from "../../quality/gate-sources.js";
import { loadTypescript } from "../../quality/ts-api.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type Change, fileAt } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";
import { runShellCheck } from "./command.js";

const MAX_LISTED = 10;

export const violationNote = (violation: TestViolation): Note =>
  note(`gate.tests.${violation.kind}`, {
    file: violation.path,
    before: violation.before ?? 0,
    after: violation.after ?? 0,
  });

const working = (ctx: GateContext, path: string): string | undefined => {
  const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, path)));
  return text.ok ? text.value : undefined;
};

const isEditedTest = (change: Change): boolean =>
  (change.status === "M" || change.status === "R") && isTestFile(change.path) && !isSnapshot(change.path);

const counterFor = (ctx: GateContext, relevant: readonly Change[]): TestCounter =>
  astCounter(relevant.length === 0 ? undefined : loadTypescript(ctx.paths.root));

const editNote = (ctx: GateContext, change: Change, count: TestCounter): Note => {
  const before = fileAt(ctx.git, ctx.base, change.oldPath ?? change.path) ?? "";
  const after = working(ctx, change.path) ?? "";
  const language = testLanguage(change.path) ?? "js";
  return note("gate.tests.edited", {
    file: change.path,
    added: addedByContent(before, after).length,
    removed: addedByContent(after, before).length,
    before: count(language, before, change.path).assertions,
    after: count(language, after, change.path).assertions,
  });
};

export interface TestsView {
  readonly violations: readonly TestViolation[];
  readonly notes: readonly Note[];
}

export const testsView = (ctx: GateContext): TestsView => {
  const relevant = ctx.changes.filter(
    (change) => isTestFile(change.path) || isTestFile(change.oldPath ?? "") || isProtectedConfig(change.path),
  );
  const count = counterFor(ctx, relevant);
  const mode = guardMode(ctx, TESTS_HOLD_GUARD);
  const unlisted = (path: string): boolean => !isListed(ctx.contract.scope, path);
  const edited = relevant.filter(isEditedTest);
  const violations = analyzeTree({
    changes: relevant,
    before: (path) => fileAt(ctx.git, ctx.base, path),
    after: (path) => working(ctx, path),
    acceptedConfigs: ctx.trust.configs,
    scopePaths: ctx.contract.scope.paths,
    testsProtected: ctx.contract.scope.testsProtected,
    count,
    held: (path) => mode === "active" && edited.some((change) => change.path === path) && unlisted(path),
  });
  const shadowHeld =
    mode === "shadow" ? edited.filter((change) => unlisted(change.path)).map((change) => change.path) : [];
  return {
    violations,
    notes: [
      ...edited.slice(0, MAX_LISTED).map((change) => editNote(ctx, change, count)),
      ...shadowHeld.slice(0, MAX_LISTED).map((file) => note("gate.tests.held_shadow", { file })),
    ],
  };
};

export const testsCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const { violations, notes: edits } = testsView(ctx);
  const grant =
    violations.length === 0
      ? undefined
      : activeGrant(ctx.runtime, ctx.paths, "tests", nowMs(ctx.runtime), ctx.sessionId);
  const notes = violations.slice(0, MAX_LISTED).map(violationNote);
  if (violations.length > 0 && grant === undefined) return failed([...notes, ...edits, note("gate.tests.fix")]);
  const released = grant === undefined ? {} : { releasedBy: `person@${grant.grantedAt}` };
  const releaseNotes =
    grant === undefined ? [] : [...notes, note("gate.note.released", { guard: "tests", reason: grant.reason })];
  if (check.run === undefined) return { ...passed([note("gate.tests.clean"), ...edits, ...releaseNotes]), ...released };
  const outcome = runShellCheck(check, check.run, ctx);
  return { ...outcome, notes: [...outcome.notes, ...edits, ...releaseNotes], ...released };
};
