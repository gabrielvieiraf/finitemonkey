import { dirname, relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { projectPaths } from "../gate/hooks/common.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { readDemoted } from "../knowledge/arms.js";
import { injectContext } from "../policy/inject.js";
import { policyNumber } from "../policy/numbers.js";
import { markUntrusted, readsUntrusted } from "../policy/untrusted.js";
import { errorSignature } from "../signals/signature.js";
import type { FmPaths } from "../task/paths.js";
import { learnFromSignatures } from "./learn.js";
import { DEFAULT_MAX_LESSONS, DEFAULT_MAX_TOKENS, type LessonKey, lessonsText, pickLessons } from "./match.js";
import { EXPIRE_DAYS, type Lesson, pruneLessons, readLessons, writeLessons } from "./store.js";

const ALLOW: HookDecision = { kind: "allow" };
const SEEN_FILE = "learnings-seen.json";
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

const failedOutput = (raw: JsonObject): string | undefined => {
  const response = raw["tool_response"];
  if (!isRecord(response)) return undefined;
  const code = response["exitCode"] ?? response["exit_code"];
  if (!((typeof code === "number" && code !== 0) || response["is_error"] === true)) return undefined;
  return [textField(response, "stdout") ?? "", textField(response, "stderr") ?? ""].join("\n");
};

const keyOf = (input: HookInput, paths: FmPaths): LessonKey | undefined => {
  const raw = input.payload.raw;
  if (input.event === "PostToolUseFailure")
    return { sig: errorSignature(textField(raw, "error") ?? "")?.sig, path: undefined };
  if (input.event === "PostToolUse") {
    const output = failedOutput(raw);
    return output === undefined ? undefined : { sig: errorSignature(output)?.sig, path: undefined };
  }
  if (input.event !== "PreToolUse" || !EDIT_TOOLS.has(toolName(raw))) return undefined;
  const file = textField(toolInput(raw), "file_path", "notebook_path");
  if (file === undefined) return undefined;
  return { sig: undefined, path: toPosixPath(relative(paths.root, toAbsolutePath(file, paths.root))) };
};

const readSeen = (input: HookInput, paths: FmPaths): ReadonlySet<string> => {
  const raw = input.runtime.readText(paths.cache(SEEN_FILE));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  if (parsed?.ok !== true || parsed.value["session"] !== (input.payload.sessionId ?? "")) return new Set();
  const seen = parsed.value["seen"];
  return new Set(Array.isArray(seen) ? seen.filter((item): item is string => typeof item === "string") : []);
};

const markUsed = (
  input: HookInput,
  paths: FmPaths,
  all: readonly Lesson[],
  used: readonly Lesson[],
  seen: ReadonlySet<string>,
) => {
  const now = input.runtime.now();
  const ids = new Set(used.map((lesson) => lesson.id));
  writeLessons(
    input.runtime,
    paths.dir,
    all.map((lesson) => (ids.has(lesson.id) ? { ...lesson, lastMatchedAt: now, uses: lesson.uses + 1 } : lesson)),
  );
  input.runtime.mkdir(toAbsolutePath(dirname(paths.cache(SEEN_FILE))));
  const next = { session: input.payload.sessionId ?? "", seen: [...new Set([...seen, ...ids])] };
  input.runtime.writeText(paths.cache(SEEN_FILE), `${JSON.stringify(next)}\n`);
};

export const learningsInject: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return ALLOW;
  const key = keyOf(input, paths);
  if (key === undefined || (key.sig === undefined && key.path === undefined)) return ALLOW;
  const lessons = readLessons(input.runtime, paths.dir);
  if (lessons.length === 0 || readDemoted(input.runtime, paths).has("learnings")) return ALLOW;
  const seen = readSeen(input, paths);
  const limits = {
    maxLessons: policyNumber(input.runtime, paths.root, ["learnings", "maxLessons"], DEFAULT_MAX_LESSONS),
    maxTokens: policyNumber(input.runtime, paths.root, ["learnings", "maxTokens"], DEFAULT_MAX_TOKENS),
  };
  const picked = pickLessons(lessons, key, limits, seen);
  if (picked.length === 0) return ALLOW;
  markUsed(input, paths, lessons, picked, seen);
  return injectContext(input, paths, { id: "learnings", event: "learning" }, lessonsText(picked), {
    lessons: picked.map((lesson) => lesson.id).join(","),
    key: key.sig === undefined ? "path" : "signature",
  });
};

export const learningsStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return ALLOW;
  pruneLessons(
    input.runtime,
    paths.dir,
    policyNumber(input.runtime, paths.root, ["learnings", "expireDays"], EXPIRE_DAYS),
  );
  learnFromSignatures(input, paths);
  return ALLOW;
};

export const untrustedRecorder: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  if (!readsUntrusted(tool)) return ALLOW;
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return ALLOW;
  input.runtime.mkdir(toAbsolutePath(dirname(paths.cache(SEEN_FILE))));
  markUntrusted(input.runtime, paths, input.payload.sessionId ?? "", tool);
  return ALLOW;
};

export const LEARNINGS_HANDLERS: HookHandlers = {
  PreToolUse: [learningsInject],
  PostToolUse: [untrustedRecorder, learningsInject],
  PostToolUseFailure: [learningsInject],
  Stop: [learningsStop],
};
