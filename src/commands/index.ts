import { appCheckCommand } from "./app-check.js";
import { appsecRulesCommand, appsecScanCommand } from "./appsec.js";
import { auditCommand } from "./audit.js";
import { briefCommand } from "./brief.js";
import { budgetCommand, costReconcileCommand } from "./budget.js";
import { conceitosCommand, conceitosExportCommand, conceitosMarkCommand, conceitosUpdateCommand } from "./conceitos.js";
import { costCheckCommand, costInitCommand } from "./cost.js";
import { credsCommand } from "./creds.js";
import { critiqueVerifyCommand } from "./critique.js";
import { dataMapCommand } from "./data-map.js";
import { debtCommand } from "./debt.js";
import { decideCheckCommand, decideNewCommand, decideRevokeCommand } from "./decide.js";
import { deployStatusCommand } from "./deploy.js";
import { depsCheckCommand } from "./deps-check.js";
import { depsConfigCommand } from "./deps-config.js";
import { depsScanCommand } from "./deps-scan.js";
import { doctorCommand } from "./doctor.js";
import { findingsAcceptCommand, findingsListCommand } from "./findings.js";
import { frontsPlanCommand, frontsStatusCommand } from "./fronts.js";
import { frontsCloseCommand } from "./fronts-close.js";
import { frontsMergeCommand } from "./fronts-merge.js";
import { frontsRouteCommand } from "./fronts-route.js";
import { frontsSyncCommand } from "./fronts-sync.js";
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
import { instructionsCommand } from "./instructions.js";
import { inventoryCommand } from "./inventory.js";
import { lookCommand } from "./look.js";
import { lookApproveCommand } from "./look-approve.js";
import { mapCommand } from "./map.js";
import { mergeCommand } from "./merge.js";
import { parityCheckCommand, parityInitCommand, parityUpdateCommand } from "./parity.js";
import { offCommand, onCommand } from "./pause.js";
import {
  perfilAnswerCommand,
  perfilCommand,
  perfilForgetCommand,
  perfilSetCommand,
  perfilStartCommand,
} from "./perfil.js";
import { planCheckCommand, planConsolidateCommand, planInitCommand } from "./plan.js";
import { plantaCommand } from "./planta.js";
import { policyFalsePositiveCommand } from "./policy.js";
import { prOpenCommand } from "./pr-open.js";
import { proseCheckCommand } from "./prose-check.js";
import { researchCheckCommand, researchNewCommand } from "./research.js";
import { reviewPacketCommand } from "./review.js";
import { rulesCheckCommand, rulesCompileCommand, rulesCoverageCommand } from "./rules.js";
import { rulesProposeCommand, rulesViolationCommand } from "./rules-propose.js";
import { runCommandSpec } from "./run.js";
import { secretsAcceptCommand } from "./secrets-accept.js";
import { secretsIncidentCommand } from "./secrets-incident.js";
import { secretsLiveCommand } from "./secrets-live.js";
import { secretsScanCommand } from "./secrets-scan.js";
import { signalsCommand, signalsForgetCommand, signalsNotLoopCommand, signalsReleaseCommand } from "./signals.js";
import { signalsHypothesisCommand } from "./signals-hypothesis.js";
import { slopDismissCommand, slopStatsCommand } from "./slop.js";
import { statuslineCommand } from "./statusline.js";
import { suggestAcceptCommand, suggestCommand, suggestDismissCommand } from "./suggest.js";
import { taskDoneCommand, taskNewCommand, taskShowCommand } from "./task.js";
import { taskAmendCommand, taskReopenCommand } from "./task-edit.js";
import { taskFromSpecCommand } from "./task-spec.js";
import type { CommandSpec } from "./types.js";
import { uninstallCommand } from "./uninstall.js";
import { updateCommand } from "./update.js";
import { versionCommand } from "./version.js";
import { wtAdoptCommand, wtNewCommand } from "./wt.js";
import { wtClassifyCommand, wtDismissCommand } from "./wt-classify.js";
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
  taskReopenCommand,
  taskAmendCommand,
  taskFromSpecCommand,
  secretsScanCommand,
  secretsAcceptCommand,
  findingsAcceptCommand,
  findingsListCommand,
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
  mergeCommand,
  prOpenCommand,
  frontsPlanCommand,
  frontsStatusCommand,
  briefCommand,
  frontsCloseCommand,
  frontsMergeCommand,
  frontsRouteCommand,
  frontsSyncCommand,
  appCheckCommand,
  appsecScanCommand,
  appsecRulesCommand,
  dataMapCommand,
  commitMsgCommand,
  pushCheckCommand,
  ciGateCommand,
  lookCommand,
  reviewPacketCommand,
  rulesCompileCommand,
  rulesCoverageCommand,
  rulesCheckCommand,
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
  costReconcileCommand,
  budgetCommand,
  parityInitCommand,
  parityUpdateCommand,
  parityCheckCommand,
  auditCommand,
  debtCommand,
  credsCommand,
  depsCheckCommand,
  depsScanCommand,
  depsConfigCommand,
  signalsCommand,
  signalsNotLoopCommand,
  signalsReleaseCommand,
  signalsForgetCommand,
  plantaCommand,
  perfilCommand,
  perfilStartCommand,
  perfilSetCommand,
  perfilAnswerCommand,
  perfilForgetCommand,
  conceitosCommand,
  conceitosExportCommand,
  conceitosUpdateCommand,
  conceitosMarkCommand,
  signalsHypothesisCommand,
  deployStatusCommand,
  lookApproveCommand,
  wtClassifyCommand,
  wtDismissCommand,
  instructionsCommand,
  rulesProposeCommand,
  rulesViolationCommand,
  runCommandSpec,
  slopDismissCommand,
  slopStatsCommand,
  suggestCommand,
  suggestAcceptCommand,
  suggestDismissCommand,
  versionCommand,
  helpCommand,
] as const satisfies readonly CommandSpec[];
