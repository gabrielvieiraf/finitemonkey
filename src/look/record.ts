import type { Runtime } from "../core/runtime.js";
import { appendEvidence } from "../evidence/ledger.js";
import { EVIDENCE_SCHEMA } from "../evidence/types.js";
import { IMPLICIT_ID } from "../task/implicit.js";
import { activeTaskId } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import type { AllowOutcome } from "./findings.js";
import type { PageResult } from "./node-capture.js";
import { projectRelative, summaryPath } from "./paths.js";
import { LOOK_SCHEMA, type LookSummary } from "./types.js";

export const LOOK_CHECK = "*look*";

export const recordLook = (
  runtime: Runtime,
  paths: FmPaths,
  tree: string,
  shot: {
    readonly results: readonly PageResult[];
    readonly sheet: string | undefined;
    readonly blocked?: readonly string[];
  },
  allowed: AllowOutcome,
): { readonly kind: "done"; readonly summary: LookSummary; readonly summaryPath: string } => {
  const failures = allowed.findings.filter((item) => item.blocking).length;
  const summary: LookSummary = {
    schema: LOOK_SCHEMA,
    treeHash: tree,
    at: runtime.now(),
    failures,
    notes: allowed.findings.length - failures,
    captures: shot.results
      .filter((result) => result.loadError === undefined)
      .map((result) => ({ route: result.route, viewport: result.viewport, path: projectRelative(paths, result.path) })),
    contactSheet: shot.sheet === undefined ? null : projectRelative(paths, shot.sheet),
    findings: allowed.findings,
    ignoredAllows: allowed.ignored,
    ...(shot.blocked === undefined || shot.blocked.length === 0 ? {} : { blockedRequests: shot.blocked.slice(0, 50) }),
  };
  const file = summaryPath(paths, tree);
  runtime.writeText(file, `${JSON.stringify(summary, null, 2)}\n`);
  const task = activeTaskId(runtime, paths) ?? IMPLICIT_ID;
  appendEvidence(runtime, paths.evidence(task), [
    {
      schema: EVIDENCE_SCHEMA,
      task,
      check: LOOK_CHECK,
      kind: "look",
      status: failures === 0 ? "passed" : "failed",
      treeHash: tree,
      at: summary.at,
      notes: [{ key: "look.recorded", params: { failures, captures: summary.captures.length } }],
    },
  ]);
  return { kind: "done", summary, summaryPath: projectRelative(paths, file) };
};
