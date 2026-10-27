import { join, relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { JsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { logEvent } from "../evidence/log.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { isCode } from "../map/defs.js";
import type { FmPaths } from "../task/paths.js";
import { elsewhere, projectDefinitions } from "./index-defs.js";
import { readReuseLog, type ReuseLog, shouldRetire, type Warning, writeReuseLog } from "./log.js";
import { definedNames, isGeneric, newDefinitions, normalizeName } from "./names.js";

const allow = { kind: "allow" } as const;
const WRITERS = new Set(["Edit", "MultiEdit", "Write"]);

const candidates = (raw: JsonObject): readonly string[] => {
  const input = toolInput(raw);
  const content = textField(input, "content");
  if (content !== undefined) return [...new Set(definedNames(content))].filter((name) => !isGeneric(name));
  return [...new Set(editsOf(input).flatMap((edit) => newDefinitions(edit.oldText, edit.newText)))];
};

const definesNow = (input: HookInput, paths: FmPaths, warning: Warning): boolean => {
  const text = input.runtime.readText(toAbsolutePath(join(paths.root, warning.file)));
  return text.ok && definedNames(text.value).some((name) => normalizeName(name) === normalizeName(warning.name));
};

const resolve = (input: HookInput, paths: FmPaths, log: ReuseLog, finish: (w: Warning) => boolean): ReuseLog => {
  const warnings = log.warnings.map((warning): Warning => {
    if (warning.outcome !== "pending" || !finish(warning)) return warning;
    return { ...warning, outcome: definesNow(input, paths, warning) ? "kept" : "reused" };
  });
  const next = { ...log, warnings };
  return { ...next, retired: log.retired || shouldRetire(next) };
};

const warn = (input: HookInput, paths: FmPaths, file: string, log: ReuseLog): HookDecision => {
  const names = candidates(input.payload.raw);
  if (log.retired || names.length === 0) return allow;
  const index = projectDefinitions(input.runtime, paths.root);
  if (index.kind === "failed") {
    logEvent(input.runtime, paths, "reuse.failed", { detail: index.detail });
    return allow;
  }
  const found = names.flatMap((name) => {
    const match = elsewhere(index.definitions, name, file);
    return match === undefined ? [] : [{ name, match }];
  });
  if (found.length === 0) return allow;
  const start = log.warnings.reduce((max, item) => Math.max(max, item.id), 0);
  const added: Warning[] = found.map(({ name, match }, offset) => ({
    id: start + offset + 1,
    at: input.runtime.now(),
    session: input.payload.sessionId ?? "",
    name,
    file,
    existing: `${match.file}:${String(match.line)}`,
    outcome: "pending",
  }));
  writeReuseLog(input.runtime, paths, { ...log, warnings: [...log.warnings, ...added] });
  for (const item of added)
    logEvent(input.runtime, paths, "reuse.warning", { id: item.id, name: item.name, file, existing: item.existing });
  const lines = found.map(({ name, match }) =>
    input.t("reuse.warning", { name, file, existingName: match.name, existing: `${match.file}:${String(match.line)}` }),
  );
  return { kind: "allow", output: contextOutput("PostToolUse", lines.join("\n")) };
};

const changedFile = (input: HookInput, paths: FmPaths): string | undefined => {
  const target = textField(toolInput(input.payload.raw), "file_path");
  if (!WRITERS.has(toolName(input.payload.raw)) || target === undefined) return undefined;
  const file = toPosixPath(relative(paths.root, toAbsolutePath(target, paths.root)));
  return isCode(file) ? file : undefined;
};

const failedOpen = (input: HookInput, error: unknown): HookDecision => {
  const paths = projectPaths(input);
  if (paths !== undefined) {
    logEvent(input.runtime, paths, "reuse.failed", { detail: error instanceof Error ? error.message : String(error) });
  }
  return allow;
};

export const reuseWarning: HookHandler = (input) => {
  try {
    const paths = projectPaths(input);
    const file = paths === undefined ? undefined : changedFile(input, paths);
    if (paths === undefined || file === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
    const log = resolve(input, paths, readReuseLog(input.runtime, paths), (warning) => warning.file === file);
    writeReuseLog(input.runtime, paths, log);
    return warn(input, paths, file, log);
  } catch (error) {
    return failedOpen(input, error);
  }
};

export const reuseOutcomes: HookHandler = (input) => {
  try {
    const paths = projectPaths(input);
    if (paths === undefined) return allow;
    const log = readReuseLog(input.runtime, paths);
    if (!log.warnings.some((warning) => warning.outcome === "pending")) return allow;
    const session = input.payload.sessionId ?? "";
    writeReuseLog(
      input.runtime,
      paths,
      resolve(input, paths, log, (warning) => warning.session === session),
    );
    return allow;
  } catch (error) {
    return failedOpen(input, error);
  }
};

export const REUSE_HANDLERS: HookHandlers = {
  PostToolUse: [reuseWarning],
  Stop: [reuseOutcomes],
  UserPromptSubmit: [reuseOutcomes],
};
