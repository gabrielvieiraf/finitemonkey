import { doctorCommand } from "./doctor.js";
import { helpCommand } from "./help.js";
import { hookCommand } from "./hook.js";
import { i18nCheckCommand } from "./i18n-check.js";
import { initCommand, uninstallCommand, updateCommand } from "./planned.js";
import { secretsAcceptCommand } from "./secrets-accept.js";
import { secretsIncidentCommand } from "./secrets-incident.js";
import { secretsScanCommand } from "./secrets-scan.js";
import type { CommandSpec } from "./types.js";
import { versionCommand } from "./version.js";

export const REGISTRY = [
  initCommand,
  doctorCommand,
  updateCommand,
  uninstallCommand,
  i18nCheckCommand,
  hookCommand,
  secretsScanCommand,
  secretsAcceptCommand,
  secretsIncidentCommand,
  versionCommand,
  helpCommand,
] as const satisfies readonly CommandSpec[];
