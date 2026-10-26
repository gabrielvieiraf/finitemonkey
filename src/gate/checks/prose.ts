import type { Parsed } from "../../core/parsed.js";
import { type ProseGateStatus, proseGateStatus } from "../../prose/gate.js";
import type { ProseSpan } from "../../prose/types.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 10;

const rulesOf = (span: ProseSpan): string => [...new Set(span.hits.map((hit) => hit.rule))].join(", ");

export const proseOutcome = (status: Parsed<ProseGateStatus>): CheckOutcome => {
  if (!status.ok) return unverified("tool_missing", [note("gate.prose.unavailable")]);
  const { files, flagged, blocking } = status.value;
  const key = blocking ? "gate.prose.finding" : "gate.prose.warning";
  const notes = flagged
    .flatMap((item) => item.report.spans.map((span) => ({ file: item.file, span })))
    .slice(0, MAX_LISTED)
    .map(({ file, span }) => note(key, { file, line: span.startLine, rules: rulesOf(span) }));
  if (notes.length === 0) return passed([note("gate.prose.clean", { count: files.length })]);
  return blocking ? failed(notes) : passed(notes);
};

export const proseCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome =>
  proseOutcome(proseGateStatus(ctx.runtime, ctx.paths.root));
