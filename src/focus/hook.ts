import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { JsonObject } from "../core/parsed.js";
import { readFronts } from "../fronts/state.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { onceFor } from "../guardian/once.js";
import { activeTask, type KnownTask, knownTasks } from "../guardian/tasks.js";
import { FILE_TOOLS } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { cardFor, cardLines } from "./card.js";
import { loadPerson } from "./config.js";
import { historyLimit } from "./limit.js";
import { type Deviation, deviationOf, pathMentions } from "./scope.js";
import { readSymbolIndex, symbolDeviations } from "./symbols.js";

export const FOCUS_FEATURE = "focus-card";
const SEEN_FILE = "focus.json";
const OPEN_FRONTS = new Set(["planned", "running", "blocked"]);

const allow: HookDecision = { kind: "allow" };

const emit = (input: HookInput, paths: FmPaths, lines: readonly string[], data: JsonObject): HookDecision => {
  if (lines.length === 0) return allow;
  if (featureMode(input.runtime, paths, FOCUS_FEATURE) !== "active") {
    recordFeatureShadow(input.runtime, paths, FOCUS_FEATURE, data);
    return allow;
  }
  const text = lines.join("\n");
  return { kind: "allow", output: contextOutput(input.event, text, text) };
};

const cardText = (input: HookInput, paths: FmPaths): readonly string[] => {
  const task = activeTask(input.runtime, paths);
  if (task === undefined || task.contract.implicit) return [];
  return cardLines(input.t, cardFor(input.runtime, paths, task.contract));
};

export const openProjects = (input: HookInput, paths: FmPaths): number => {
  const tasks = knownTasks(input.runtime, paths).filter((task) => !task.done && !task.contract.implicit).length;
  const fronts = readFronts(input.runtime, paths.root);
  return tasks + (fronts.ok ? fronts.value.fronts.filter((front) => OPEN_FRONTS.has(front.status)).length : 0);
};

const limitLines = (input: HookInput, paths: FmPaths): readonly string[] => {
  const task = activeTask(input.runtime, paths);
  if (task === undefined || task.contract.implicit) return [];
  if (!onceFor(input.runtime, paths, "focus-limit.json", task.contract.id)) return [];
  const limit = loadPerson(input.runtime, paths.root).projectLimit;
  const open = openProjects(input, paths);
  return open > limit ? [input.t("focus.limit", { open, limit })] : [];
};

const proposalLines = (input: HookInput, paths: FmPaths): readonly string[] => {
  const proposal = historyLimit(input.runtime, paths, knownTasks(input.runtime, paths));
  if (proposal === undefined || proposal.limit === loadPerson(input.runtime, paths.root).projectLimit) return [];
  if (!onceFor(input.runtime, paths, "focus-limit-proposal.json", String(proposal.limit))) return [];
  const weeks = proposal.weeks.map((week) => `${week.week} (${String(week.open)})`).join(", ");
  return [input.t("focus.limit.proposal", { limit: proposal.limit, weeks })];
};

const idleReturn = (input: HookInput, paths: FmPaths): boolean => {
  const file = paths.cache(SEEN_FILE);
  const last = readJsonFile(input.runtime, file)?.["lastPromptAt"];
  const now = input.runtime.now();
  writeJsonFile(input.runtime, file, { lastPromptAt: now });
  if (typeof last !== "string") return false;
  const gapMs = Date.parse(now) - Date.parse(last);
  return gapMs > loadPerson(input.runtime, paths.root).idleMinutes * 60_000;
};

const usable = (input: HookInput): FmPaths | undefined => {
  const paths = projectPaths(input);
  return paths !== undefined && input.runtime.stat(paths.dir)?.kind === "dir" ? paths : undefined;
};

const shown = (lines: readonly string[], reason: string): JsonObject => ({
  reason,
  card: sha256Hex(lines.join("\n")).slice(0, 16),
});

export const focusSession: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined) return allow;
  const lines = [...cardText(input, paths), ...limitLines(input, paths), ...proposalLines(input, paths)];
  return emit(input, paths, lines, shown(lines, textField(input.payload.raw, "source") ?? "startup"));
};

export const focusPrompt: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined) return allow;
  const lines = [...(idleReturn(input, paths) ? cardText(input, paths) : []), ...limitLines(input, paths)];
  return emit(input, paths, lines, shown(lines, "prompt"));
};

const askPark = (input: HookInput, paths: FmPaths, task: KnownTask, found: Deviation): boolean =>
  onceFor(input.runtime, paths, "focus-parking.json", `${task.contract.id}\u0000${found.area}`);

const parkQuestion = (input: HookInput, task: KnownTask, found: Deviation): string =>
  input.t("focus.park.ask", { file: found.file, task: task.contract.id, scope: task.contract.scope.paths.join(", ") });

export const focusAfterEdit: HookHandler = (input) => {
  const raw = input.payload.raw;
  const target = FILE_TOOLS.has(toolName(raw)) ? textField(toolInput(raw), "file_path", "notebook_path") : undefined;
  const paths = usable(input);
  const task = paths === undefined ? undefined : activeTask(input.runtime, paths);
  if (target === undefined || paths === undefined || task === undefined || task.contract.implicit) return allow;
  const found = deviationOf(paths.root, task.contract.scope.paths, target);
  if (found === undefined || !askPark(input, paths, task, found)) return allow;
  return emit(input, paths, [parkQuestion(input, task, found)], { reason: "park", area: found.area });
};

export const focusPromptScope: HookHandler = (input) => {
  const paths = usable(input);
  const task = paths === undefined ? undefined : activeTask(input.runtime, paths);
  if (paths === undefined || task === undefined || task.contract.implicit) return allow;
  const exists = (file: string): boolean => input.runtime.stat(toAbsolutePath(join(paths.root, file))) !== undefined;
  const prompt = textField(input.payload.raw, "prompt") ?? "";
  const scope = task.contract.scope.paths;
  const deviations = [
    ...pathMentions(prompt, exists).flatMap((file) => deviationOf(paths.root, scope, file) ?? []),
    ...symbolDeviations(prompt, readSymbolIndex(input.runtime, paths.root), scope),
  ];
  const found = deviations.find((item) => askPark(input, paths, task, item));
  if (found === undefined) return allow;
  return emit(input, paths, [parkQuestion(input, task, found)], { reason: "park-prompt", area: found.area });
};

export const FOCUS_HANDLERS: HookHandlers = {
  SessionStart: [focusSession],
  UserPromptSubmit: [focusPrompt, focusPromptScope],
  PostToolUse: [focusAfterEdit],
};
