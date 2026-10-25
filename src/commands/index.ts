import { doctorCommand } from "./doctor.js";
import { gateCommand } from "./gate.js";
import { helpCommand } from "./help.js";
import { hookCommand } from "./hook.js";
import { i18nCheckCommand } from "./i18n-check.js";
import { initCommand } from "./init.js";
import { secretsAcceptCommand } from "./secrets-accept.js";
import { secretsIncidentCommand } from "./secrets-incident.js";
import { secretsScanCommand } from "./secrets-scan.js";
import { taskDoneCommand, taskNewCommand, taskShowCommand } from "./task.js";
import type { CommandSpec } from "./types.js";
import { uninstallCommand } from "./uninstall.js";
import { updateCommand } from "./update.js";
import { versionCommand } from "./version.js";

export const REGISTRY = [
  initCommand,
  doctorCommand,
  updateCommand,
  uninstallCommand,
  i18nCheckCommand,
  hookCommand,
  gateCommand,
  taskNewCommand,
  taskShowCommand,
  taskDoneCommand,
  secretsScanCommand,
  secretsAcceptCommand,
  secretsIncidentCommand,
  versionCommand,
  helpCommand,
] as const satisfies readonly CommandSpec[];
