import {
  DEFAULT_VIOLATION_LIMIT,
  type DriftFinding,
  gitDriftInput,
  INSTRUCTION_DRIFT_FEATURE,
  instructionDrift,
} from "../instructions/drift.js";
import { featureMode } from "../policy/feature.js";
import { policyNumber } from "../policy/numbers.js";
import { fmPaths } from "../task/paths.js";
import { type Check, finding } from "./types.js";

const example = (item: DriftFinding): string =>
  `${item.at.file}:${String(item.at.line)}${item.at.commit === null ? "" : ` (${item.at.commit.slice(0, 7)})`}`;

export const checkInstructionDrift: Check = (env) => {
  if (featureMode(env.runtime, fmPaths(env.root), INSTRUCTION_DRIFT_FEATURE) === "off") return [];
  const violationLimit = policyNumber(env.runtime, env.root, ["knowledge", "violationLimit"], DEFAULT_VIOLATION_LIMIT);
  const found = instructionDrift(gitDriftInput(env.runtime, env.root, { conflicts: [], violationLimit }));
  const first = found[0];
  if (first === undefined) return [];
  return [
    finding(
      "instructions.drift",
      "warn",
      "doctor.instructions.drift",
      { count: found.length, example: example(first) },
      "doctor.instructions.fix_drift",
    ),
  ];
};
