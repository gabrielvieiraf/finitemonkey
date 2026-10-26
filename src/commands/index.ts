import { doctorCommand } from "./doctor.js";
import { mergeVerifyCommand } from "./git-merge-verify.js";
import { rescueCommand } from "./git-rescue.js";
import { snapshotCommand, undoCommand } from "./git-undo.js";
import { helpCommand } from "./help.js";
import { hookCommand } from "./hook.js";
import { i18nCheckCommand } from "./i18n-check.js";
import { initCommand } from "./init.js";
import { secretsAcceptCommand } from "./secrets-accept.js";
import { secretsIncidentCommand } from "./secrets-incident.js";
import { secretsScanCommand } from "./secrets-scan.js";
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
  secretsScanCommand,
  secretsAcceptCommand,
  secretsIncidentCommand,
  snapshotCommand,
  undoCommand,
  rescueCommand,
  mergeVerifyCommand,
  versionCommand,
  helpCommand,
] as const satisfies readonly CommandSpec[];
