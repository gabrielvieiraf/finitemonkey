import { appCheckCommand } from "./app-check.js";
import { doctorCommand } from "./doctor.js";
import { gateCommand } from "./gate.js";
import { ciGateCommand, commitMsgCommand, pushCheckCommand } from "./git-checks.js";
import { mergeVerifyCommand } from "./git-merge-verify.js";
import { rescueCommand } from "./git-rescue.js";
import { snapshotCommand, undoCommand } from "./git-undo.js";
import { helpCommand } from "./help.js";
import { hookCommand } from "./hook.js";
import { i18nCheckCommand } from "./i18n-check.js";
import { initCommand } from "./init.js";
import { offCommand, onCommand } from "./pause.js";
import { policyFalsePositiveCommand } from "./policy.js";
import { lookCommand } from "./look.js";
import { proseCheckCommand } from "./prose-check.js";
import { secretsAcceptCommand } from "./secrets-accept.js";
import { secretsIncidentCommand } from "./secrets-incident.js";
import { secretsLiveCommand } from "./secrets-live.js";
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
  policyFalsePositiveCommand,
  offCommand,
  onCommand,
  secretsIncidentCommand,
  secretsLiveCommand,
  proseCheckCommand,
  snapshotCommand,
  undoCommand,
  rescueCommand,
  mergeVerifyCommand,
  appCheckCommand,
  commitMsgCommand,
  pushCheckCommand,
  ciGateCommand,
  lookCommand,
  versionCommand,
  helpCommand,
] as const satisfies readonly CommandSpec[];
