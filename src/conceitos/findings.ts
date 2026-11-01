import { type AppsecFinding, RULE_CWE } from "../appsec/types.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { type ConceptEvent, recordConceptEvents } from "./evidence.js";
import { recognizeFindings } from "./recognize.js";

export const recordFindingConcepts = (
  runtime: Pick<Runtime, "appendText" | "now" | "readText">,
  paths: FmPaths,
  findings: readonly Pick<AppsecFinding, "rule" | "file">[],
  task: string,
): readonly ConceptEvent[] =>
  recordConceptEvents(
    runtime,
    paths,
    findings.flatMap((finding) =>
      recognizeFindings([RULE_CWE[finding.rule]]).map((item) => ({
        concept: item.concept,
        kind: "exposure" as const,
        origin: "agent" as const,
        task,
        file: finding.file,
        source: item.source,
        match: item.match,
      })),
    ),
  );
