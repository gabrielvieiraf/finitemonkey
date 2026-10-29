import { cochangeDismissCommand } from "./cochange.js";
import { restoreCheckCommand, restoreDrillCommand } from "./restore.js";
import { testsSelectCommand } from "./tests-select.js";
import type { CommandSpec } from "./types.js";

export const DATA_COMMANDS: readonly CommandSpec[] = [
  restoreCheckCommand,
  restoreDrillCommand,
  cochangeDismissCommand,
  testsSelectCommand,
];
