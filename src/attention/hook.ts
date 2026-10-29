import type { JsonObject } from "../core/parsed.js";
import { logEvent } from "../evidence/log.js";
import { loadPerson } from "../focus/config.js";
import { contextOutput, human, projectPaths } from "../gate/hooks/common.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { onceFor } from "../guardian/once.js";
import { activeTask, knownTasks } from "../guardian/tasks.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { BELL, deliver, inQuietHours, quietRange } from "./notify.js";
import { elapsedMs, horizonFor } from "./timebox.js";

export const ATTENTION_FEATURE = "attention";
const STATE_FILE = "attention.json";
const HOUR_MS = 3_600_000;

const allow: HookDecision = { kind: "allow" };

const usable = (input: HookInput): FmPaths | undefined => {
  const paths = projectPaths(input);
  return paths !== undefined && input.runtime.stat(paths.dir)?.kind === "dir" ? paths : undefined;
};

const readMemo = (input: HookInput, paths: FmPaths): JsonObject =>
  readJsonFile(input.runtime, paths.cache(STATE_FILE)) ?? {};

const writeMemo = (input: HookInput, paths: FmPaths, change: JsonObject): void => {
  const rest = Object.fromEntries(Object.entries(readMemo(input, paths)).filter(([key]) => key !== "schemaVersion"));
  writeJsonFile(input.runtime, paths.cache(STATE_FILE), { ...rest, ...change });
};

const active = (input: HookInput, paths: FmPaths, kind: string): boolean => {
  if (featureMode(input.runtime, paths, ATTENTION_FEATURE) === "active") return true;
  recordFeatureShadow(input.runtime, paths, ATTENTION_FEATURE, { kind });
  return false;
};

const notify = (input: HookInput, paths: FmPaths, kind: string, body: string): HookDecision => {
  if (!active(input, paths, kind)) return allow;
  const range = quietRange(loadPerson(input.runtime, paths.root).quietHours);
  if (inQuietHours(new Date(input.runtime.now()).getHours(), range)) {
    logEvent(input.runtime, paths, "attention.quiet", { kind });
    return allow;
  }
  const channel = deliver(input.runtime, paths.root, process.platform, { title: "finitemonkey", body });
  logEvent(input.runtime, paths, "attention.notify", { kind, channel });
  return channel === "bell" ? { kind: "allow", output: { systemMessage: `${BELL}${human(body)}` } } : allow;
};

export const attentionAsk: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined) return allow;
  const message = (textField(input.payload.raw, "message") ?? "").slice(0, 160);
  writeMemo(input, paths, { askedAt: input.runtime.now() });
  return notify(input, paths, "ask", input.t("attention.ask", { message }));
};

export const attentionGate: HookHandler = (input) => {
  const paths = usable(input);
  const status = paths === undefined ? undefined : readGateStatus(input.runtime, paths);
  if (paths === undefined || status === undefined || readMemo(input, paths)["gateAt"] === status.at) return allow;
  writeMemo(input, paths, { gateAt: status.at });
  return notify(input, paths, "gate", input.t("attention.gate", { status: status.status, task: status.task }));
};

export const attentionTimebox: HookHandler = (input) => {
  const paths = usable(input);
  const task = paths === undefined ? undefined : activeTask(input.runtime, paths);
  if (paths === undefined || task === undefined || task.contract.implicit) return allow;
  const horizon = horizonFor(input.runtime, paths, () => knownTasks(input.runtime, paths), task);
  const elapsed = elapsedMs(input.runtime, paths, task);
  if (horizon === undefined || elapsed === undefined || elapsed <= horizon) return allow;
  if (!onceFor(input.runtime, paths, "attention-timebox.json", task.contract.id)) return allow;
  if (!active(input, paths, "timebox")) return allow;
  const params = {
    task: task.contract.id,
    elapsed: (elapsed / HOUR_MS).toFixed(1),
    horizon: (horizon / HOUR_MS).toFixed(1),
  };
  const text = input.t("attention.timebox", params);
  return { kind: "allow", output: contextOutput("UserPromptSubmit", text, human(text)) };
};

const crossedMidnight = (from: string, to: string): boolean =>
  new Date(from).toDateString() !== new Date(to).toDateString();

const rhythm = (input: HookInput, paths: FmPaths, startedAt: string): HookDecision => {
  const hours = loadPerson(input.runtime, paths.root).rhythmHours;
  const now = input.runtime.now();
  const long = hours > 0 && Date.parse(now) - Date.parse(startedAt) > hours * HOUR_MS;
  if (hours === 0 || (!long && !crossedMidnight(startedAt, now))) return allow;
  if (!onceFor(input.runtime, paths, "attention-rhythm.json", input.payload.sessionId ?? "")) return allow;
  if (!active(input, paths, "rhythm")) return allow;
  return { kind: "allow", output: { systemMessage: human(input.t("attention.rhythm", { hours })) } };
};

export const attentionPrompt: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined) return allow;
  const memo = readMemo(input, paths);
  const session = input.payload.sessionId ?? "";
  const askedAt = memo["askedAt"];
  if (typeof askedAt === "string") {
    logEvent(input.runtime, paths, "attention.answered", {
      waitMs: Date.parse(input.runtime.now()) - Date.parse(askedAt),
    });
  }
  const started =
    memo["session"] === session && typeof memo["startedAt"] === "string" ? memo["startedAt"] : input.runtime.now();
  writeMemo(input, paths, { askedAt: null, session, startedAt: started });
  return rhythm(input, paths, started);
};

export const ATTENTION_HANDLERS: HookHandlers = {
  Notification: [attentionAsk],
  Stop: [attentionGate],
  PostToolUse: [attentionGate],
  UserPromptSubmit: [attentionPrompt, attentionTimebox],
};
