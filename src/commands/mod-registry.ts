import { bypassReviewCommand } from "./bypass.js";
import { conceitosEvidenceCommand } from "./conceitos.js";
import { frontsBoardCommand } from "./fronts-board.js";
import { handoffCommand } from "./handoff.js";
import { modRecordCommand, modStateCommand } from "./mod.js";
import { modCostCommand, modUsageCommand } from "./mod-cost.js";
import { statusCommand } from "./status.js";
import { taskTrustCommand } from "./task-trust.js";
import type { CommandSpec } from "./types.js";

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
] as const satisfies readonly CommandSpec[];
