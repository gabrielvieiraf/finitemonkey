import { appCheckCommand } from "./app-check.js";
import { costCheckCommand, costInitCommand } from "./cost.js";
import { critiqueVerifyCommand } from "./critique.js";
import { decideCheckCommand, decideNewCommand, decideRevokeCommand } from "./decide.js";
import { doctorCommand } from "./doctor.js";
import { gainCommand } from "./gain.js";
import { gateCommand } from "./gate.js";
import { ciGateCommand, commitMsgCommand, pushCheckCommand } from "./git-checks.js";
import { mergeVerifyCommand } from "./git-merge-verify.js";
import { rescueCommand } from "./git-rescue.js";
import { snapshotCommand, undoCommand } from "./git-undo.js";
import { helpCommand } from "./help.js";
import { hookCommand } from "./hook.js";
import { i18nCheckCommand } from "./i18n-check.js";
import { initCommand } from "./init.js";
import { inventoryCommand } from "./inventory.js";
import { lookCommand } from "./look.js";
import { mapCommand } from "./map.js";
import { offCommand, onCommand } from "./pause.js";
import { planCheckCommand, planConsolidateCommand, planInitCommand } from "./plan.js";
import { policyFalsePositiveCommand } from "./policy.js";
import { proseCheckCommand } from "./prose-check.js";
import { researchCheckCommand, researchNewCommand } from "./research.js";
import { reviewPacketCommand } from "./review.js";
import { secretsAcceptCommand } from "./secrets-accept.js";
import { secretsIncidentCommand } from "./secrets-incident.js";
import { secretsLiveCommand } from "./secrets-live.js";
import { secretsScanCommand } from "./secrets-scan.js";
import { statuslineCommand } from "./statusline.js";
import { taskDoneCommand, taskNewCommand, taskShowCommand } from "./task.js";
import type { CommandSpec } from "./types.js";
import { uninstallCommand } from "./uninstall.js";
import { updateCommand } from "./update.js";
import { versionCommand } from "./version.js";
import { wtAdoptCommand, wtNewCommand } from "./wt.js";
import { wtArchiveCommand, wtCleanCommand, wtPurgeCommand } from "./wt-clean.js";
import { wtDoctorCommand, wtListCommand } from "./wt-list.js";

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
  gainCommand,
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
  reviewPacketCommand,
  statuslineCommand,
  critiqueVerifyCommand,
  inventoryCommand,
  wtNewCommand,
  wtAdoptCommand,
  mapCommand,
  planInitCommand,
  planCheckCommand,
  planConsolidateCommand,
  wtListCommand,
  wtCleanCommand,
  wtArchiveCommand,
  wtPurgeCommand,
  wtDoctorCommand,
  decideNewCommand,
  decideCheckCommand,
  decideRevokeCommand,
  researchNewCommand,
  researchCheckCommand,
  costInitCommand,
  costCheckCommand,
  versionCommand,
  helpCommand,
] as const satisfies readonly CommandSpec[];
