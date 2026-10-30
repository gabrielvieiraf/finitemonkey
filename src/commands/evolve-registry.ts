import { calibrateExplainCommand, calibrateRefitCommand } from "./calibrate.js";
import { policyEvolveCommand, policyHistoryCommand, policyRevertCommand } from "./policy-evolve.js";
import type { CommandSpec } from "./types.js";

export const EVOLVE_COMMANDS: readonly CommandSpec[] = [
  policyEvolveCommand,
  policyHistoryCommand,
  policyRevertCommand,
  calibrateRefitCommand,
  calibrateExplainCommand,
];
