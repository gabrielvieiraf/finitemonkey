import { doctorCommand } from "./doctor.js";
import { helpCommand } from "./help.js";
import { hookCommand } from "./hook.js";
import { i18nCheckCommand } from "./i18n-check.js";
import { initCommand, uninstallCommand, updateCommand } from "./planned.js";
import type { CommandSpec } from "./types.js";
import { versionCommand } from "./version.js";

export const REGISTRY = [
  initCommand,
  doctorCommand,
  updateCommand,
  uninstallCommand,
  i18nCheckCommand,
  hookCommand,
  versionCommand,
  helpCommand,
] as const satisfies readonly CommandSpec[];
