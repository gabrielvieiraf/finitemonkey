import { secretsGateStatus } from "../../secrets/gate.js";
import { blocking, isWarning } from "../../secrets/rules/types.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { readSession } from "../baseline.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 10;
const EPOCH = "1970-01-01T00:00:00.000Z";

type SecretsGateContext = Pick<GateContext, "runtime" | "paths">;

const sinceOf = (ctx: SecretsGateContext): string => {
  const session = readSession(ctx.runtime, ctx.paths);
  return session === undefined ? EPOCH : new Date(session.at).toISOString();
};

export const secretsCheck = (_check: AcceptanceCheck, ctx: SecretsGateContext): CheckOutcome => {
  const status = secretsGateStatus(ctx.runtime, ctx.paths.root, sinceOf(ctx));
  if (!status.ok) return unverified("tool_missing", [note("gate.secrets.unavailable")]);
  const { findings, openIncidents } = status.value;
  const warnings = findings
    .filter(isWarning)
    .slice(0, MAX_LISTED)
    .map((finding) => note("gate.secrets.warning", { file: finding.file, line: finding.line, rule: finding.ruleId }));
  const notes = [
    ...blocking(findings)
      .slice(0, MAX_LISTED)
      .map((finding) => note("gate.secrets.finding", { file: finding.file, line: finding.line, rule: finding.ruleId })),
    ...openIncidents
      .slice(0, MAX_LISTED)
      .map((incident) => note("gate.secrets.incident", { id: incident.id, state: incident.state })),
  ];
  if (notes.length > 0) return failed([...notes, ...warnings]);
  return passed(warnings.length > 0 ? warnings : [note("gate.secrets.clean")]);
};
