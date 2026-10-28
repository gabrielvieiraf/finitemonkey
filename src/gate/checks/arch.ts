import { ARCH_FEATURE, loadArch } from "../../arch/config.js";
import { archRatchet } from "../../arch/ratchet.js";
import { type ArchFinding, workingTree } from "../../arch/scan.js";
import type { Note } from "../../evidence/types.js";
import { guardMode } from "../../quality/gate-sources.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 10;

export const archNote = (finding: ArchFinding): Note => {
  const { violation } = finding;
  return note(`gate.arch.${violation.rule}`, {
    file: violation.from,
    line: violation.line,
    to: violation.to,
    from_layer: violation.fromLayer,
    to_layer: violation.toLayer,
    hint: violation.hint,
  });
};

export const archCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, ARCH_FEATURE);
  if (mode === "off") return passed([note("gate.arch.off")]);
  const loaded = loadArch(ctx.runtime, ctx.paths.root);
  if (loaded.kind === "absent") return passed([note("gate.arch.no_config")]);
  if (loaded.kind === "invalid") return failed([note("gate.arch.invalid", { issues: loaded.issues.join("; ") })]);
  const result = archRatchet({
    runtime: ctx.runtime,
    paths: ctx.paths,
    root: ctx.paths.root,
    git: ctx.git,
    base: ctx.base,
    config: loaded.config,
    tree: workingTree(ctx.runtime, ctx.git, ctx.paths.root, ctx.changes),
  });
  if (result === undefined) return unverified("no_evidence", [note("gate.arch.baseline_invalid")]);
  const summary = [
    ...(result.adopted > 0 ? [note("gate.arch.adopted", { count: result.adopted })] : []),
    ...(result.fixed > 0 ? [note("gate.arch.fixed", { count: result.fixed })] : []),
    ...(result.known > 0 ? [note("gate.arch.known", { count: result.known })] : []),
  ];
  if (result.fresh.length === 0) return passed([note("gate.arch.clean"), ...summary]);
  const listed = result.fresh.slice(0, MAX_LISTED).map(archNote);
  if (mode === "shadow")
    return passed([note("gate.arch.shadow", { count: result.fresh.length }), ...listed, ...summary]);
  return failed([...listed, ...summary]);
};
