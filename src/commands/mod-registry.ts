import { bypassReviewCommand } from "./bypass.js";
import { conceitosEvidenceCommand } from "./conceitos.js";
import { frontsBoardCommand } from "./fronts-board.js";
import { handoffCommand } from "./handoff.js";
import { modRecordCommand, modStateCommand } from "./mod.js";
import { modCostCommand, modUsageCommand } from "./mod-cost.js";
import {
  probeAnswerCommand,
  probeCommand,
  probeForgetCommand,
  probeGapCommand,
  probeNextCommand,
  probeProposeCommand,
  probeSkipCommand,
} from "./probe.js";
import { statusCommand } from "./status.js";
import { taskTrustCommand } from "./task-trust.js";
import { trajectoryCommand, trajectoryExportCommand, trajectoryForgetCommand } from "./trajectory.js";
import type { CommandSpec } from "./types.js";
import { xrayCommand, xrayDecideCommand, xrayExportCommand, xrayForgetCommand } from "./xray.js";

export const MOD_COMMANDS = [
  modStateCommand,
  modRecordCommand,
  statusCommand,
  bypassReviewCommand,
  handoffCommand,
  modCostCommand,
  modUsageCommand,
  frontsBoardCommand,
  taskTrustCommand,
  conceitosEvidenceCommand,
  xrayCommand,
  xrayForgetCommand,
  xrayExportCommand,
  xrayDecideCommand,
  probeCommand,
  probeProposeCommand,
  probeNextCommand,
  probeAnswerCommand,
  probeSkipCommand,
  probeGapCommand,
  probeForgetCommand,
  trajectoryCommand,
  trajectoryForgetCommand,
  trajectoryExportCommand,
] as const satisfies readonly CommandSpec[];
