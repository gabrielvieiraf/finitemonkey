import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { maskText } from "../mask/mask.js";
import type { FmPaths } from "../task/paths.js";

export const PROMPTS_FILE = "prompts.jsonl";

export interface PersonRequest {
  readonly at: string;
  readonly session: string;
  readonly text: string;
}

export const promptsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, PROMPTS_FILE));

const SYSTEM_WRAPPED = /^\s*<(command-|local-command|system-reminder|bash-)/;

export const isPersonText = (text: string): boolean =>
  text.trim() !== "" && comesFromPerson(text) && !SYSTEM_WRAPPED.test(text);

export const promptLog: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const paths = projectPaths(input);
  if (paths === undefined || !isPersonText(prompt)) return { kind: "allow" };
  const record: PersonRequest = {
    at: input.runtime.now(),
    session: input.payload.sessionId ?? "",
    text: maskText(prompt),
  };
  input.runtime.appendText(promptsPath(paths), `${JSON.stringify(record)}\n`);
  return { kind: "allow" };
};

export const readPrompts = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly PersonRequest[] => {
  const text = runtime.readText(promptsPath(paths));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const parsed = parseJsonObject(line);
    if (!parsed.ok || !isRecord(parsed.value)) return [];
    const { at, session, text: body } = parsed.value;
    return typeof at === "string" && typeof session === "string" && typeof body === "string"
      ? [{ at, session, text: body }]
      : [];
  });
};
