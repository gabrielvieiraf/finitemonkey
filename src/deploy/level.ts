import { basename } from "node:path";

import type { AbsolutePath } from "../core/brand.js";
import type { Problem } from "../core/problem.js";
import type { Runtime } from "../core/runtime.js";
import { checkDecisions, DECISION_FILE } from "../decide/check.js";
import { ExitCode } from "../exit-codes.js";
import { infraYaml, preservedFields, readHosts, readInfraText, readLevel, withTopFields } from "../infra/file.js";
import { INFRA_FILE } from "../infra/file.js";
import { planFiles, writePlanned } from "../infra/plan-files.js";
import { scanInfra } from "../infra/scan.js";
import type { DeployLevel } from "../infra/types.js";
import { planPath } from "../plan/folder.js";
import { readFront } from "../plan/front.js";

export interface LevelRequest {
  readonly level: DeployLevel | undefined;
  readonly evidence: string | undefined;
  readonly decision: string | undefined;
}

export type RecordOutcome = { readonly ok: true } | { readonly ok: false; readonly problem: Problem };

const needsDecision = (level: DeployLevel, detected: DeployLevel, decision: string | undefined): Problem => ({
  code: "deploy_level_needs_decision",
  messageKey: "deploy.plan.needs_decision",
  params: { level, detected, decision: decision ?? "-" },
  fix: `finitemonkey decide new "deploy level ${String(level)}"`,
  exitCode: ExitCode.CheckFailed,
});

const acceptedDecision = (runtime: Runtime, root: AbsolutePath, decision: string | undefined): string | undefined => {
  if (decision === undefined) return undefined;
  const name = basename(decision);
  if (!DECISION_FILE.test(name)) return undefined;
  const text = runtime.readText(planPath(root, name));
  if (!text.ok || readFront(text.value).data?.["status"] !== "accepted") return undefined;
  return checkDecisions(runtime, root, name).issues.length === 0 ? `docs/plan/${name}` : undefined;
};

const fieldsFor = (
  runtime: Runtime,
  request: LevelRequest,
  decision: string | undefined,
): Readonly<Record<string, string | number>> => ({
  ...(request.level === undefined
    ? {}
    : {
        level: request.level,
        level_source: "confirmed",
        ...(decision === undefined ? {} : { level_decision: decision }),
      }),
  ...(request.evidence === undefined
    ? {}
    : { rollback_evidence: `${request.evidence.trim()} (${runtime.now().slice(0, 10)})` }),
});

export const recordLevel = (runtime: Runtime, root: AbsolutePath, request: LevelRequest): RecordOutcome => {
  const inventory = scanInfra(runtime, root, readHosts(runtime, root));
  const decision = acceptedDecision(runtime, root, request.decision);
  if (request.level !== undefined && request.level > inventory.level && decision === undefined)
    return { ok: false, problem: needsDecision(request.level, inventory.level, request.decision) };
  const fields = fieldsFor(runtime, request, decision);
  const current = readInfraText(runtime, root);
  const base =
    current ??
    infraYaml(
      inventory,
      readLevel(runtime, root) ?? { level: inventory.level, source: "detected" },
      preservedFields(runtime, root),
    );
  const planned = planFiles(runtime, root, [{ path: INFRA_FILE, text: withTopFields(base, fields) }]);
  const saved = writePlanned(runtime, root, planned, true);
  if (saved.failed.length === 0) return { ok: true };
  return {
    ok: false,
    problem: {
      code: "deploy_write_failed",
      messageKey: "infra.write_failed",
      params: { file: INFRA_FILE },
      fix: "check that .finitemonkey can be written",
      exitCode: ExitCode.Internal,
    },
  };
};
