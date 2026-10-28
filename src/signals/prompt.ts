import { contextOutput, human } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { readState } from "../task/state.js";
import { baseOf, progressKey, record, scopeOf } from "./context.js";
import { thresholdsOf } from "./loop-index.js";
import { contextLine, pasteSummary } from "./render.js";
import { promptFingerprint } from "./similarity.js";
import { readProfile } from "./store.js";
import { loopKey, readNotice, writeIndex } from "./write-index.js";

const allow = { kind: "allow" } as const;

export const CLEAR_AFTER = 2;

export const signalsPrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  if (prompt.trim() === "" || !comesFromPerson(prompt)) return allow;
  const before = scopeOf(input);
  if (before === undefined) return allow;
  const scope = record(before, {
    ...baseOf(before),
    turn: before.turn + 1,
    kind: "prompt",
    fp: promptFingerprint(prompt),
    progress: progressKey(before),
  });
  const notice = readNotice(scope);
  const index = writeIndex(scope, notice);
  const key = loopKey(index);
  if (!index.firing || key === notice.lastKey) return allow;
  const injections = notice.injections + 1;
  writeIndex(scope, { injections, lastKey: key });
  const { t } = input;
  const line = contextLine(t, index, thresholdsOf(readProfile(input.runtime, scope.files)));
  if (injections < CLEAR_AFTER) return { kind: "allow", output: contextOutput("UserPromptSubmit", line) };
  const summary = pasteSummary(t, index, readState(input.runtime, scope.paths).active);
  return {
    kind: "allow",
    output: contextOutput("UserPromptSubmit", line, human(t("signals.human.clear", { summary }))),
  };
};
