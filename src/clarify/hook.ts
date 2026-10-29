import { logEvent } from "../evidence/log.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { readCachedBar } from "../planta/store.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { domainOfText, recordHorizon } from "../signals/blind-band.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import { requestSize } from "./size.js";

export const CLARIFY_FEATURE = "clarify";
export const MAX_QUESTIONS = 3;
const ASKED_FILE = "clarify.json";
const KEEP_SESSIONS = 50;

const allow = { kind: "allow" } as const;

const askedSessions = (runtime: Parameters<HookHandler>[0]["runtime"], paths: FmPaths): readonly string[] => {
  const raw = readJsonFile(runtime, paths.cache(ASKED_FILE))?.["sessions"];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
};

export const clarifyPrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  if (prompt.trim() === "" || !comesFromPerson(prompt)) return allow;
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
  const { runtime, t } = input;
  if (readState(runtime, paths).active !== undefined) return allow;
  const mode = featureMode(runtime, paths, CLARIFY_FEATURE);
  if (mode === "off") return allow;
  const size = requestSize(prompt, { blueprint: readCachedBar(runtime, paths) !== undefined });
  if (size === "S") return allow;
  const session = input.payload.sessionId ?? "";
  const asked = askedSessions(runtime, paths);
  if (asked.includes(session)) return allow;
  writeJsonFile(runtime, paths.cache(ASKED_FILE), { sessions: [...asked, session].slice(-KEEP_SESSIONS) });
  logEvent(runtime, paths, "clarify.asked", { size, mode, session });
  if (mode === "shadow") {
    recordFeatureShadow(runtime, paths, CLARIFY_FEATURE, { size });
    return allow;
  }
  recordHorizon(runtime, paths, { source: "clarify", criterion: "none", domain: domainOfText(prompt) });
  return {
    kind: "allow",
    output: contextOutput("UserPromptSubmit", t("clarify.context", { size, max: MAX_QUESTIONS })),
  };
};

export const CLARIFY_HANDLERS: HookHandlers = { UserPromptSubmit: [clarifyPrompt] };
