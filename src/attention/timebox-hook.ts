import { logEvent } from "../evidence/log.js";
import { park } from "../focus/parking.js";
import { contextOutput, human } from "../gate/hooks/common.js";
import { activeTask, knownTasks } from "../guardian/tasks.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import type { FmPaths } from "../task/paths.js";
import { attentionActive, usable } from "./feature.js";
import { readAsk, shouldAsk, type TimeboxAsk, timeboxReply, writeAsk } from "./reply.js";
import { elapsedMs, horizonFor } from "./timebox.js";

const HOUR_MS = 3_600_000;

const allow: HookDecision = { kind: "allow" };

const say = (text: string): HookDecision => ({
  kind: "allow",
  output: contextOutput("UserPromptSubmit", text, human(text)),
});

export const attentionTimebox: HookHandler = (input) => {
  const paths = usable(input);
  const task = paths === undefined ? undefined : activeTask(input.runtime, paths);
  if (paths === undefined || task === undefined || task.contract.implicit) return allow;
  const horizon = horizonFor(input.runtime, paths, () => knownTasks(input.runtime, paths), task);
  const elapsed = elapsedMs(input.runtime, paths, task);
  if (horizon === undefined || horizon <= 0 || elapsed === undefined || elapsed <= horizon) return allow;
  const step = Math.floor(elapsed / horizon);
  if (!shouldAsk(readAsk(input.runtime, paths), task.contract.id, step)) return allow;
  const shown = attentionActive(input, paths, "timebox");
  writeAsk(input.runtime, paths, { task: task.contract.id, step, pending: shown, answer: null });
  if (!shown) return allow;
  return say(
    input.t("attention.timebox", {
      task: task.contract.id,
      elapsed: (elapsed / HOUR_MS).toFixed(1),
      horizon: (horizon / HOUR_MS).toFixed(1),
    }),
  );
};

const stopTask = (input: HookInput, paths: FmPaths, ask: TimeboxAsk): HookDecision => {
  const idea = park(input.runtime, paths, ask.task, input.t("attention.timebox.idea", { task: ask.task }));
  return say(
    idea === undefined
      ? input.t("attention.timebox.stopped", { task: ask.task })
      : input.t("attention.timebox.parked", { task: ask.task, id: idea.id }),
  );
};

export const attentionReply: HookHandler = (input) => {
  const paths = usable(input);
  const ask = paths === undefined ? undefined : readAsk(input.runtime, paths);
  if (paths === undefined || ask?.pending !== true) return allow;
  const reply = timeboxReply(textField(input.payload.raw, "prompt") ?? "");
  writeAsk(input.runtime, paths, { ...ask, pending: false, answer: reply ?? null });
  logEvent(input.runtime, paths, "attention.timebox", { task: ask.task, answer: reply ?? "ignored" });
  if (reply === undefined) return allow;
  return reply === "stop"
    ? stopTask(input, paths, ask)
    : say(input.t("attention.timebox.continued", { task: ask.task }));
};
