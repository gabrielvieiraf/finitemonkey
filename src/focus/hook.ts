import { isAbsolute, relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { JsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { readFronts } from "../fronts/state.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { onceFor } from "../guardian/once.js";
import { activeTask, knownTasks } from "../guardian/tasks.js";
import { FILE_TOOLS } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { cardFor, cardLines } from "./card.js";
import { loadPerson } from "./config.js";

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
  const lines = [...cardText(input, paths), ...limitLines(input, paths)];
  return emit(input, paths, lines, shown(lines, textField(input.payload.raw, "source") ?? "startup"));
};

export const focusPrompt: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined) return allow;
  const lines = [...(idleReturn(input, paths) ? cardText(input, paths) : []), ...limitLines(input, paths)];
  return emit(input, paths, lines, shown(lines, "prompt"));
};

const relativeFile = (root: string, target: string): string | undefined => {
  const rel = relative(root, toAbsolutePath(target, toAbsolutePath(root)));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const posix = toPosixPath(rel);
  return posix.startsWith(".finitemonkey/") || posix.startsWith(".git/") ? undefined : posix;
};

const scopeGlobs = (paths: readonly string[]): readonly string[] =>
  paths.flatMap((path) => (path.endsWith("/") ? [path, `${path}**`] : [path, `${path}/**`]));

export const focusAfterEdit: HookHandler = (input) => {
  const raw = input.payload.raw;
  const target = FILE_TOOLS.has(toolName(raw)) ? textField(toolInput(raw), "file_path", "notebook_path") : undefined;
  const paths = usable(input);
  const task = paths === undefined ? undefined : activeTask(input.runtime, paths);
  if (target === undefined || paths === undefined || task === undefined || task.contract.implicit) return allow;
  const scope = task.contract.scope.paths;
  const file = relativeFile(paths.root, target);
  if (file === undefined || scope.length === 0 || matchesAny(file, scopeGlobs(scope))) return allow;
  const area = file.includes("/") ? file.slice(0, file.indexOf("/")) : file;
  if (!onceFor(input.runtime, paths, "focus-parking.json", `${task.contract.id}\u0000${area}`)) return allow;
  const line = input.t("focus.park.ask", { file, task: task.contract.id, scope: scope.join(", ") });
  return emit(input, paths, [line], { reason: "park", area });
};

export const FOCUS_HANDLERS: HookHandlers = {
  SessionStart: [focusSession],
  UserPromptSubmit: [focusPrompt],
  PostToolUse: [focusAfterEdit],
};
