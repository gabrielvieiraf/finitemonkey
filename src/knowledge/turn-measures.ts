import { relative } from "node:path";

import { readCost } from "../bridge/cost.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { projectPaths } from "../gate/hooks/common.js";
import { parseTranscript, type ToolUse, type Turn } from "../history/transcript.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { loadBasePolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { INSTRUCTION_SOURCES, logEntries } from "./instruction-arms.js";

export const LOCALIZATION_EVENT = "experiment_localization";
const READ_TOOLS: ReadonlySet<string> = new Set(["Read"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export interface Localization {
  readonly read: string;
  readonly edited: string;
  readonly localized: boolean;
}

const fileOf = (tool: ToolUse, root: AbsolutePath): string | undefined => {
  const file = tool.input["file_path"] ?? tool.input["notebook_path"];
  return typeof file === "string" && file !== "" ? toPosixPath(relative(root, toAbsolutePath(file, root))) : undefined;
};

export const localizationOf = (turns: readonly Turn[], root: AbsolutePath): Localization | undefined => {
  const tools = turns.flatMap((turn) => turn.tools);
  const first = tools.findIndex((tool) => READ_TOOLS.has(tool.name) && fileOf(tool, root) !== undefined);
  const firstTool = tools[first];
  const read = firstTool === undefined ? undefined : fileOf(firstTool, root);
  const edit = tools.slice(first + 1).find((tool) => EDIT_TOOLS.has(tool.name) && fileOf(tool, root) !== undefined);
  const edited = edit === undefined ? undefined : fileOf(edit, root);
  return read === undefined || edited === undefined ? undefined : { read, edited, localized: read === edited };
};

export const localizations = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlyMap<string, boolean> => {
  const found = new Map<string, boolean>();
  for (const entry of logEntries(runtime, paths, [LOCALIZATION_EVENT])) {
    const { task, localized } = entry;
    if (typeof task === "string" && typeof localized === "boolean" && !found.has(task)) found.set(task, localized);
  }
  return found;
};

export const tokensPerTurn = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlyMap<string, number> => {
  const totals = new Map<string, { tokens: number; turns: Set<string> }>();
  for (const line of readCost(runtime, paths)) {
    const entry = totals.get(line.task) ?? { tokens: 0, turns: new Set<string>() };
    entry.tokens += line.input + line.output + line.cacheRead + line.cacheWrite;
    entry.turns.add(line.at);
    totals.set(line.task, entry);
  }
  return new Map([...totals].map(([task, entry]) => [task, entry.tokens / Math.max(1, entry.turns.size)]));
};

const measured = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): boolean => {
  const experiments = loadBasePolicy(runtime, paths.root).experiments;
  return [...INSTRUCTION_SOURCES, "knowledge-claims", "learnings"].some((source) => experiments[source] === "random");
};

export const localizationStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  const task = paths === undefined ? undefined : readState(input.runtime, paths).active;
  if (paths === undefined || task === undefined || !measured(input.runtime, paths)) return { kind: "allow" };
  if (localizations(input.runtime, paths).has(task)) return { kind: "allow" };
  const file = textField(input.payload.raw, "transcript_path");
  const text = file === undefined || file === "" ? undefined : input.runtime.readText(toAbsolutePath(file));
  const found = text?.ok === true ? localizationOf(parseTranscript(text.value), paths.root) : undefined;
  if (found !== undefined) logEvent(input.runtime, paths, LOCALIZATION_EVENT, { task, ...found });
  return { kind: "allow" };
};
