import { logEvent } from "../evidence/log.js";
import { deny } from "../guards/context.js";
import type { HookDecision } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import type { Translate } from "../i18n/translate.js";
import { inlineData } from "../policy/untrusted.js";
import { hypothesesFor, type PendingAttempt, stoppedAttempt } from "./attempts.js";
import { baseOf, record, type SignalScope } from "./context.js";
import { signalLimits } from "./limits.js";
import { sessionEntries, type SignalEntry } from "./store.js";

const editedFiles = (entries: readonly SignalEntry[]): readonly string[] => [
  ...new Set(entries.flatMap((entry) => (entry.kind === "edit" ? [entry.file] : []))),
];

export const stopSummary = (t: Translate, entries: readonly SignalEntry[], stopped: PendingAttempt): string => {
  const files = editedFiles(entries);
  const tried = hypothesesFor(entries, stopped.sig);
  return [
    t("signals.summary.error", {
      sig: stopped.sig,
      count: stopped.failed,
      sample: inlineData("tool output", stopped.sample),
    }),
    ...(files.length === 0 ? [] : [t("signals.summary.files", { files: files.join(", ") })]),
    ...(tried.length === 0 ? [] : [t("signals.stop.tried", { list: tried.join(" | ") })]),
  ].join(" ");
};

const alreadyStopped = (entries: readonly SignalEntry[], sig: string): boolean => {
  const lastError = entries.findLastIndex((entry) => entry.kind === "error");
  return entries.slice(lastError + 1).some((entry) => entry.kind === "stopped" && entry.sig === sig);
};

export const stopDecision = (scope: SignalScope, mode: string): HookDecision | undefined => {
  const { runtime, t } = scope.input;
  const entries = sessionEntries(scope.entries, scope.session);
  const stopped = stoppedAttempt(entries, signalLimits(runtime, scope.paths.root).stopAfter);
  if (stopped === undefined) return undefined;
  const noted = alreadyStopped(entries, stopped.sig);
  if (noted && mode !== "active") return { kind: "allow" };
  if (!noted) {
    record(scope, { ...baseOf(scope), kind: "stopped", sig: stopped.sig, mode });
    logEvent(runtime, scope.paths, "signals.stopped", { sig: stopped.sig, failed: stopped.failed, mode });
  }
  const params = { sig: stopped.sig, count: stopped.failed, summary: stopSummary(t, entries, stopped) };
  const blocked = deny(modelReason(t, "signals.fourth.stop", params), t("signals.fourth.stop.human", params));
  return blocked.kind === "block" ? { ...blocked, warning: t("signals.fourth.stop.warning", params) } : blocked;
};
