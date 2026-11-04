import { projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { recordConversationLang } from "../i18n/conversation.js";

const allow = { kind: "allow" } as const;

export const conversationLangPrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  if (prompt.trim() === "" || !comesFromPerson(prompt)) return allow;
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
  recordConversationLang(input.runtime, paths.root, prompt);
  return allow;
};
