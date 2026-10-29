import { basename, join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { human } from "../gate/hooks/common.js";
import { deny } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason, type ReasonBase } from "../hooks/reason.js";
import type { Params } from "../i18n/translate.js";
import { loadTask } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import type { TaskContract } from "../task/types.js";
import { baseOf, projectFile, record, scopeOf, type SignalScope } from "./context.js";
import { signalLimits } from "./limits.js";
import { sessionEntries, type SignalEntry } from "./store.js";
import { syntaxProblem } from "./syntax.js";
import { writesFiles } from "./writes.js";

export const SYNTAX_GUARD = "syntax-check";
export const EARLY_GUARD = "early-loops";
export const REPRO_GUARD = "reproduce-first";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const LONG_SIZES = new Set(["M", "L"]);
const allow = { kind: "allow" } as const;

type HumanKey =
  | "signals.syntax.human"
  | "signals.early.failed_edits.human"
  | "signals.early.blind_edits.human"
  | "signals.early.ignored_error.human";

const feedback = (input: HookInput, base: ReasonBase, humanKey: HumanKey, params: Params): HookDecision => {
  const reason = modelReason(input.t, base, params);
  return {
    kind: "block",
    reason,
    output: { decision: "block", reason, systemMessage: human(input.t(humanKey, params)) },
  };
};

const editedFile = (scope: SignalScope): string | undefined => {
  const raw = scope.input.payload.raw;
  const target = textField(toolInput(raw), "file_path", "notebook_path");
  return EDIT_TOOLS.has(toolName(raw)) && target !== undefined ? projectFile(scope, target) : undefined;
};

export const syntaxAfterEdit: HookHandler = (input) => {
  const scope = scopeOf(input);
  const file = scope === undefined ? undefined : editedFile(scope);
  if (scope === undefined || file === undefined) return allow;
  const text = input.runtime.readText(toAbsolutePath(join(scope.paths.root, file)));
  const problem = text.ok ? syntaxProblem(file, text.value) : undefined;
  if (problem === undefined) return allow;
  record(scope, { ...baseOf(scope), kind: "edit_failed", file, why: "syntax" });
  const where = problem.line > 0 ? `${file}:${String(problem.line)}` : file;
  return feedback(input, "signals.syntax", "signals.syntax.human", { file, where, message: problem.message });
};

const outcomes = (entries: readonly SignalEntry[], file: string): readonly boolean[] => {
  const result: boolean[] = [];
  for (const entry of entries) {
    if (entry.kind === "edit" && entry.file === file) result.push(true);
    if (entry.kind === "edit_failed" && entry.file === file) {
      if (entry.why === "syntax" && result.at(-1) === true) result[result.length - 1] = false;
      else result.push(false);
    }
  }
  return result;
};

export const failedInARow = (entries: readonly SignalEntry[], file: string): number => {
  const list = outcomes(entries, file);
  const lastSuccess = list.lastIndexOf(true);
  return list.length - 1 - lastSuccess;
};

const ranSomething = (entry: SignalEntry): boolean =>
  entry.kind === "run" || (entry.kind === "error" && SHELL_TOOLS.has(entry.tool));

export const editsSinceRun = (entries: readonly SignalEntry[]): number => {
  const lastRun = entries.findLastIndex(ranSomething);
  return entries.slice(lastRun + 1).filter((entry) => entry.kind === "edit").length;
};

const NOISE = new Set(["permission", "approved"]);

export const ignoredError = (entries: readonly SignalEntry[], file: string): readonly string[] | undefined => {
  const actions = entries.filter((entry) => !NOISE.has(entry.kind));
  const last = actions.at(-1);
  const before = actions.at(-2);
  if (last?.kind !== "edit" || last.file !== file || before?.kind !== "error") return undefined;
  if (!SHELL_TOOLS.has(before.tool)) return undefined;
  const named = before.files ?? [];
  return named.length === 0 || named.includes(basename(file)) ? undefined : named;
};

const trigger = (scope: SignalScope, file: string): HookDecision => {
  const { input } = scope;
  const entries = sessionEntries(scope.entries, scope.session);
  const limits = signalLimits(input.runtime, scope.paths.root);
  const failed = failedInARow(entries, file);
  if (failed === limits.failedEdits) {
    return feedback(input, "signals.early.failed_edits", "signals.early.failed_edits.human", { file, count: failed });
  }
  if (input.event !== "PostToolUse") return allow;
  const named = ignoredError(entries, file);
  if (named !== undefined) {
    return feedback(input, "signals.early.ignored_error", "signals.early.ignored_error.human", {
      file,
      files: named.slice(0, 3).join(", "),
    });
  }
  const blind = editsSinceRun(entries);
  if (entries.at(-1)?.kind === "edit" && blind === limits.editsWithoutRun) {
    return feedback(input, "signals.early.blind_edits", "signals.early.blind_edits.human", { count: blind });
  }
  return allow;
};

export const earlyLoopTriggers: HookHandler = (input) => {
  const scope = scopeOf(input);
  const file = scope === undefined ? undefined : editedFile(scope);
  if (scope === undefined || file === undefined) return allow;
  return trigger(scope, file);
};

const activeContract = (input: HookInput, paths: FmPaths): TaskContract | undefined => {
  const active = readState(input.runtime, paths).active;
  if (active === undefined) return undefined;
  const disk = (relative: string): string | undefined => {
    const text = input.runtime.readText(toAbsolutePath(join(paths.root, relative)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(input.runtime, paths, { disk, base: () => undefined }, active);
  return loaded.ok ? loaded.value.contract : undefined;
};

const LOCATED_FRESH_MS = 12 * 3_600_000;

const locatedNow = (scope: SignalScope, entry: SignalEntry): boolean =>
  entry.kind === "located" &&
  (entry.session === scope.session || nowMs(scope.input.runtime) - Date.parse(entry.at) <= LOCATED_FRESH_MS);

export const reproduceFirst: HookHandler = (input) => {
  if (!writesFiles(input.payload.raw)) return allow;
  const scope = scopeOf(input);
  if (scope === undefined) return allow;
  const entries = sessionEntries(scope.entries, scope.session);
  const started = entries.some(
    (entry) => entry.kind === "edit" || entry.kind === "checkpoint" || entry.kind === "edit_failed",
  );
  if (started || entries.some((entry) => entry.kind === "error")) return allow;
  if (scope.entries.some((entry) => locatedNow(scope, entry))) return allow;
  const contract = activeContract(input, scope.paths);
  if (contract === undefined || !LONG_SIZES.has(contract.size)) return allow;
  record(scope, { ...baseOf(scope), kind: "checkpoint", task: contract.id });
  const params = { task: contract.id, size: contract.size };
  return deny(modelReason(input.t, "signals.repro", params), input.t("signals.repro.human", params));
};
