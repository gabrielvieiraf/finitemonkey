import { bypassReviewCommand } from "./bypass.js";
import { frontsBoardCommand } from "./fronts-board.js";
import { handoffCommand } from "./handoff.js";
import { modRecordCommand, modStateCommand } from "./mod.js";
import { modCostCommand, modUsageCommand } from "./mod-cost.js";
import { statusCommand } from "./status.js";
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
] as const satisfies readonly CommandSpec[];
