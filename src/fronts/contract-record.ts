import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { DECISION_RECORD_FEATURE, type DecisionRecord, writeRecord } from "../knowledge/decision-record.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { readTrust } from "../task/state.js";
import type { Front } from "./state.js";

type Files = Pick<Runtime, "readText" | "writeText" | "mkdir" | "homeDir" | "appendText" | "now">;

const stampOf = (iso: string): string => iso.replace(/[^0-9]/g, "").slice(0, 14);

export const contractRecord = (runtime: Files, root: AbsolutePath, front: Front, message: string): DecisionRecord => {
  const subject = front.contract ?? front.id;
  const at = runtime.now();
  return {
    task: `${subject}-contract-${stampOf(at)}`,
    contractHash:
      front.contract === null ? null : (readTrust(runtime, fmPaths(root)).contracts[front.contract] ?? null),
    at,
    changes: [{ class: "contract", detail: `${front.id}: ${message}` }],
    paths: front.paths,
    alternatives: [],
    criteria: [],
    research: [],
    evidence: null,
    cost: { gateRuns: 0, minutesToGreen: null, usd: null },
  };
};

export const recordContractChange = (
  runtime: Files,
  root: AbsolutePath,
  front: Front,
  message: string,
): string | undefined => {
  const paths = fmPaths(root);
  const mode = featureMode(runtime, paths, DECISION_RECORD_FEATURE);
  if (mode === "off") return undefined;
  const record = contractRecord(runtime, root, front, message);
  if (mode === "shadow") {
    recordFeatureShadow(runtime, paths, DECISION_RECORD_FEATURE, { contractChange: record.task });
    return undefined;
  }
  return writeRecord(runtime, paths, record) ? record.task : undefined;
};
