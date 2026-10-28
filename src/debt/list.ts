import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { linesOf } from "../inventory/grep.js";
import { projectPreset } from "../prose/preset.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { readShortcutRows } from "./ledger.js";
import { evaluateTrigger, type TriggerState } from "./trigger.js";

export interface DebtItem {
  readonly source: "closed" | "open" | "marker";
  readonly task?: string;
  readonly what: string;
  readonly ceiling?: string;
  readonly trigger?: string;
  readonly where?: string;
  readonly state: TriggerState;
  readonly detail: string;
}

const MARKER = /shortcut:\s*(.+?)(?:\s+trigger:\s*(\S.*?))?\s*(?:\*\/|-->)?\s*$/i;

const markerItems = (runtime: Runtime, paths: FmPaths): readonly Omit<DebtItem, "state" | "detail">[] =>
  linesOf(
    gitAt(runtime, paths.root).out([
      "grep",
      "-n",
      "-I",
      "-i",
      "-E",
      "-e",
      "(//|#|/\\*|<!--|--) *shortcut:",
      "--",
      ".",
      ":(exclude)docs/plan",
      ":(exclude).finitemonkey",
    ]),
  ).flatMap((line) => {
    const at = /^(.+?):(\d+):(.*)$/.exec(line);
    const match = at === null ? null : MARKER.exec(at[3] ?? "");
    if (at === null || match?.[1] === undefined) return [];
    return [
      {
        source: "marker" as const,
        what: match[1],
        ...(match[2] === undefined ? {} : { trigger: match[2] }),
        where: `${at[1] ?? ""}:${at[2] ?? ""}`,
      },
    ];
  });

const openItems = (runtime: Runtime, paths: FmPaths): readonly Omit<DebtItem, "state" | "detail">[] => {
  const active = readState(runtime, paths).active;
  if (active === undefined) return [];
  const text = runtime.readText(paths.task(active));
  const parsed = text.ok ? parseContract(active, text.value) : undefined;
  return parsed?.ok === true
    ? (parsed.value.shortcuts ?? []).map((item) => ({ source: "open" as const, task: active, ...item }))
    : [];
};

export const listDebt = (runtime: Runtime, paths: FmPaths): readonly DebtItem[] => {
  const closed = readShortcutRows(runtime, paths).map((row) => ({
    source: "closed" as const,
    task: row.task,
    what: row.what,
    ...(row.ceiling === undefined ? {} : { ceiling: row.ceiling }),
    ...(row.trigger === undefined ? {} : { trigger: row.trigger }),
    ...(row.where === undefined ? {} : { where: row.where }),
  }));
  const markers = projectPreset(runtime, paths.root) === "neutral" ? markerItems(runtime, paths) : [];
  return [...closed, ...openItems(runtime, paths), ...markers].map((item) => {
    const result = evaluateTrigger(runtime, paths.root, item.trigger);
    return { ...item, state: result.state, detail: result.detail };
  });
};
