import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { nowMs } from "../../core/clock.js";
import { isRecord, parseJsonObject } from "../../core/parsed.js";
import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import { loadProjectConfig } from "../../git/project-config.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import { accessConfig, isRouteFile, SCENARIOS_FEATURE } from "../../scenarios/plan.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const RUN_TIMEOUT_MS = 180_000;
const MIN_REMAINING_MS = 5_000;
const KINDS = new Set(["owner_reads", "other_reads", "other_changes", "other_deletes", "anonymous_reads", "setup"]);

export const touchesAccess = (ctx: GateContext): boolean => {
  if ((ctx.size?.sensitive.length ?? 0) > 0) return true;
  return ctx.changes.some((change) => {
    if (change.status === "D") return false;
    const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, change.path)));
    return text.ok && isRouteFile(change.path, text.value);
  });
};

interface Ran {
  readonly kind: string;
  readonly resource: string;
  readonly passed: boolean;
  readonly status: string;
}

const resultsOf = (stdout: string): readonly Ran[] | undefined => {
  const body = parseJsonObject(stdout.trim().split("\n").at(-1) ?? "");
  const data = body.ok ? body.value["data"] : undefined;
  const results = isRecord(data) ? data["results"] : undefined;
  if (!isRecord(data) || data["ran"] !== true || !Array.isArray(results)) return undefined;
  return results.flatMap((item: unknown): Ran[] =>
    isRecord(item) &&
    typeof item["kind"] === "string" &&
    KINDS.has(item["kind"]) &&
    typeof item["resource"] === "string" &&
    typeof item["passed"] === "boolean"
      ? [
          {
            kind: item["kind"],
            resource: item["resource"],
            passed: item["passed"],
            status: typeof item["status"] === "number" ? String(item["status"]) : "-",
          },
        ]
      : [],
  );
};

const resultNote = (item: Ran): Note =>
  note(`gate.scenarios.${item.passed ? "pass" : "fail"}.${item.kind}`, {
    resource: item.resource,
    status: item.status,
  });

export const scenariosCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, SCENARIOS_FEATURE);
  if (mode === "off") return passed([note("gate.scenarios.off")]);
  if (!touchesAccess(ctx)) return passed([note("gate.scenarios.untouched")]);
  if (accessConfig(loadProjectConfig(ctx.runtime, ctx.paths.root)) === undefined) {
    const missing = note("gate.scenarios.not_configured");
    return mode === "active" ? unverified("tool_missing", [missing]) : passed([missing]);
  }
  if (!ctx.trusted) return unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]);
  const remaining = ctx.deadline - nowMs(ctx.runtime);
  if (remaining < MIN_REMAINING_MS) return unverified("budget", [note("gate.note.budget")]);
  const run = ctx.runtime.execSelf(["scenarios", "run", "--json"], ctx.paths.root, Math.min(remaining, RUN_TIMEOUT_MS));
  const results = run.timedOut ? undefined : resultsOf(run.stdout);
  if (results === undefined) return unverified("no_evidence", [note("gate.scenarios.not_run")]);
  const failures = results.filter((item) => !item.passed);
  logEvent(ctx.runtime, ctx.paths, "scenarios.ran", {
    task: ctx.contract.id,
    mode,
    total: results.length,
    failed: failures.length,
  });
  const notes = results.map(resultNote);
  if (failures.length === 0) return passed(notes);
  if (mode === "active") return failed(notes);
  recordFeatureShadow(ctx.runtime, ctx.paths, SCENARIOS_FEATURE, { task: ctx.contract.id, failed: failures.length });
  return passed([...notes, note("gate.scenarios.shadow", { count: failures.length })]);
};
