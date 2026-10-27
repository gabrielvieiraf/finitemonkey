import { allowWith, human, projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { clearPause, pausedFor, setPause } from "./pause.js";

const COMMAND = /^\s*(fm|finitemonkey)\s+(off|on)\s*$/i;

export const pausePrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const match = COMMAND.exec(prompt);
  if (match === null || !comesFromPerson(prompt)) return { kind: "allow" };
  const paths = projectPaths(input);
  const sessionId = input.payload.sessionId;
  if (paths === undefined || sessionId === undefined) return { kind: "allow" };
  const off = (match[2] ?? "").toLowerCase() === "off";
  if (off) setPause(input.runtime, paths, sessionId, "prompt");
  else clearPause(input.runtime, paths, "prompt");
  return { kind: "block", reason: human(input.t(off ? "pause.off" : "pause.on")) };
};

export const unlessPaused =
  (handler: HookHandler): HookHandler =>
  (input) => {
    const paths = projectPaths(input);
    const pause = paths === undefined ? undefined : pausedFor(input.runtime, paths, input.payload.sessionId);
    if (pause === undefined) return handler(input);
    return allowWith({ systemMessage: human(input.t("pause.report", { since: pause.since })) });
  };
