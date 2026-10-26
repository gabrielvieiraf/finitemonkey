import { secretsGateStatus } from "../../secrets/gate.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { readSession } from "../baseline.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 10;
const EPOCH = "1970-01-01T00:00:00.000Z";

const sinceOf = (ctx: GateContext): string => {
  const session = readSession(ctx.runtime, ctx.paths);
  return session === undefined ? EPOCH : new Date(session.at).toISOString();
};

export const secretsCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const status = secretsGateStatus(ctx.runtime, ctx.paths.root, sinceOf(ctx));
  if (!status.ok) return unverified("tool_missing", [note("gate.secrets.unavailable")]);
  const { findings, openIncidents } = status.value;
  const notes = [
    ...findings
      .slice(0, MAX_LISTED)
      .map((finding) => note("gate.secrets.finding", { file: finding.file, line: finding.line, rule: finding.ruleId })),
    ...openIncidents
      .slice(0, MAX_LISTED)
      .map((incident) => note("gate.secrets.incident", { id: incident.id, state: incident.state })),
  ];
  return notes.length > 0 ? failed(notes) : passed([note("gate.secrets.clean")]);
};
