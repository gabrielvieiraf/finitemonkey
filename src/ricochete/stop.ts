import { logEvent } from "../evidence/log.js";
import { human } from "../gate/hooks/common.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { judgmentSignal, taskInView } from "./context.js";
import { criterionIds, hasPerturbation, isHorizonHelp } from "./markers.js";
import { coverage } from "./perturbation.js";

const allow = { kind: "allow" } as const;
const REPORTED_FILE = "ricochete.json";

const block = (reason: string, note: string): HookDecision => ({
  kind: "block",
  reason,
  persistent: true,
  output: { decision: "block", reason, systemMessage: human(note) },
});

const messageOf = (input: HookInput): string => textField(input.payload.raw, "last_assistant_message") ?? "";

export const horizonGuard: HookHandler = (input) => {
  const message = messageOf(input);
  if (!isHorizonHelp(message)) return allow;
  const view = taskInView(input);
  if (view === undefined || !judgmentSignal(input, view.paths)) return allow;
  const ids = new Set(view.checks.map((check) => check.id));
  const named = criterionIds(message);
  if (named.some((id) => ids.has(id))) return allow;
  const { t } = input;
  const params = { task: view.task, named: named.join(", ") || "-", checks: [...ids].join(", ") };
  logEvent(input.runtime, view.paths, "ricochete.horizon_without_criterion", { task: view.task, named: [...named] });
  return block(t("ricochete.horizon.reason", params), t("ricochete.horizon.human", params));
};

const reportedTasks = (input: HookInput, view: NonNullable<ReturnType<typeof taskInView>>): readonly string[] => {
  const raw = readJsonFile(input.runtime, view.paths.cache(REPORTED_FILE))?.["tasks"];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
};

export const perturbationReport: HookHandler = (input) => {
  const view = taskInView(input);
  if (view === undefined || !view.closing || hasPerturbation(messageOf(input))) return allow;
  if (!judgmentSignal(input, view.paths)) return allow;
  const reported = reportedTasks(input, view);
  if (reported.includes(view.task)) return allow;
  writeJsonFile(input.runtime, view.paths.cache(REPORTED_FILE), { tasks: [...reported, view.task].slice(-100) });
  const { t } = input;
  const lines = coverage(view.checks).map((item) =>
    t(item.checks.length === 0 ? "ricochete.perturbation.open" : "ricochete.perturbation.covered", {
      question: t(`ricochete.perturbation.${item.question}`),
      checks: item.checks.join(", "),
    }),
  );
  const reason = [t("ricochete.perturbation.reason", { task: view.task }), ...lines].join("\n");
  logEvent(input.runtime, view.paths, "ricochete.perturbation", { task: view.task });
  return block(reason, t("ricochete.perturbation.human", { task: view.task }));
};

export const RICOCHETE_HANDLERS: HookHandlers = { Stop: [horizonGuard, perturbationReport] };
