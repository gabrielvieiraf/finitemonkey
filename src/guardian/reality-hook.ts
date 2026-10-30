import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { deny } from "../guards/context.js";
import { toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { openHighImpact, refreshTriggers } from "./assumptions.js";
import { criterionPrompt, readCriteria, writeCriteria } from "./criteria.js";
import { appendDecision } from "./decisions.js";
import { readGoals } from "./goals.js";
import { irreversibleStep } from "./irreversible.js";
import { onceFor } from "./once.js";
import { type RealityReport, renderReport, showable } from "./report.js";
import { activeTask, taskList } from "./tasks.js";
import { goalConflicts, growthReports, irreversibleReport, type TriggerBase } from "./triggers.js";

export const REALITY_FEATURE = "reality";
const ONCE_FILE = "guardian-reports.json";
const SHADOW_FILE = "guardian-shadow.json";
const WRITERS = new Set(["Write", "Edit", "MultiEdit"]);
const allow: HookDecision = { kind: "allow" };

const baseOf = (input: HookInput, paths: FmPaths): TriggerBase | undefined => {
  const task = activeTask(input.runtime, paths);
  if (task === undefined) return undefined;
  const text = input.runtime.readText(paths.task(task.contract.id));
  const ids = text.ok ? taskList(text.value, "assumptions") : [];
  const open = ids.length === 0 ? [] : openHighImpact(refreshTriggers(input.runtime, paths), ids);
  return { t: input.t, task, goals: readGoals(input.runtime, paths.root), open };
};

const record = (input: HookInput, paths: FmPaths, report: RealityReport, criterion?: string): void => {
  appendDecision(input.runtime, paths, {
    source: "report",
    at: input.runtime.now(),
    subject: report.request,
    recommendation: report.recommendation,
    evidence: report.evidence,
    decision: "pending",
    paths: report.paths,
    trigger: report.trigger,
    ...(criterion === undefined ? {} : { criterion }),
  });
};

const signatureOf = (base: TriggerBase, report: RealityReport): string =>
  sha256Hex([base.task.contract.id, report.trigger, report.key].join("\u0000"));

const reviewStep = (input: HookInput, paths: FmPaths, base: TriggerBase, report: RealityReport): HookDecision => {
  const signature = signatureOf(base, report);
  const state = readCriteria(input.runtime, paths);
  const criterion = state.criteria[signature];
  if (criterion === undefined) {
    writeCriteria(input.runtime, paths, { ...state, pending: signature });
    return deny(input.t("guardian.level3.ask", { finding: report.finding }), input.t("guardian.level3.ask_human"));
  }
  if (!onceFor(input.runtime, paths, ONCE_FILE, signature)) return allow;
  record(input, paths, report, criterion);
  return deny(
    `${input.t("guardian.level3.criterion", { criterion })}\n${renderReport(input.t, report)}`,
    input.t("guardian.level.human", { level: report.level, trigger: report.trigger }),
  );
};

const chooseStep = (input: HookInput, paths: FmPaths, base: TriggerBase, report: RealityReport): HookDecision => {
  if (!onceFor(input.runtime, paths, ONCE_FILE, signatureOf(base, report))) return allow;
  record(input, paths, report);
  return deny(
    renderReport(input.t, report),
    input.t("guardian.level.human", { level: report.level, trigger: report.trigger }),
  );
};

const noteStep = (input: HookInput, paths: FmPaths, base: TriggerBase, report: RealityReport): HookDecision => {
  if (!onceFor(input.runtime, paths, ONCE_FILE, signatureOf(base, report))) return allow;
  return { kind: "allow", output: contextOutput("PreToolUse", renderReport(input.t, report)) };
};

export const reportsFor = (input: HookInput, paths: FmPaths, base: TriggerBase): readonly RealityReport[] => {
  const step = irreversibleStep(input.payload.raw, paths.root);
  const writes = WRITERS.has(toolName(input.payload.raw));
  return [
    ...(step === undefined ? [] : [irreversibleReport(base, step)]),
    ...(writes ? goalConflicts(base) : []),
    ...(writes ? growthReports(base) : []),
  ].filter(showable);
};

const shadowStep = (input: HookInput, paths: FmPaths, base: TriggerBase, report: RealityReport): HookDecision => {
  if (!onceFor(input.runtime, paths, SHADOW_FILE, signatureOf(base, report))) return allow;
  if (report.level === 1) {
    recordFeatureShadow(input.runtime, paths, REALITY_FEATURE, { trigger: report.trigger, level: report.level });
    return allow;
  }
  return deny(
    renderReport(input.t, report),
    input.t("guardian.level.human", { level: report.level, trigger: report.trigger }),
  );
};

export const realityGuard: HookHandler = (input) => {
  const paths = projectPaths(input);
  const base = paths === undefined ? undefined : baseOf(input, paths);
  if (paths === undefined || base === undefined) return allow;
  const report = [...reportsFor(input, paths, base)].sort((a, b) => b.level - a.level)[0];
  if (report === undefined) return allow;
  if (featureMode(input.runtime, paths, REALITY_FEATURE) !== "active") return shadowStep(input, paths, base, report);
  if (report.level === 3) return reviewStep(input, paths, base, report);
  if (report.level === 2) return chooseStep(input, paths, base, report);
  return noteStep(input, paths, base, report);
};

export const REALITY_HANDLERS: HookHandlers = { PreToolUse: [realityGuard], UserPromptSubmit: [criterionPrompt] };
