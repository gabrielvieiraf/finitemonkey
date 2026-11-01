import type { JsonObject } from "../core/parsed.js";
import { logEvent } from "../evidence/log.js";
import { loadPerson } from "../focus/config.js";
import { human } from "../gate/hooks/common.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { onceFor } from "../guardian/once.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { attentionActive, usable } from "./feature.js";
import { BELL, deliver, inQuietHours, quietRange } from "./notify.js";
import { attentionReply, attentionTimebox } from "./timebox-hook.js";

const STATE_FILE = "attention.json";
const HOUR_MS = 3_600_000;

const allow: HookDecision = { kind: "allow" };

const readMemo = (input: HookInput, paths: FmPaths): JsonObject =>
  readJsonFile(input.runtime, paths.cache(STATE_FILE)) ?? {};

const writeMemo = (input: HookInput, paths: FmPaths, change: JsonObject): void => {
  const rest = Object.fromEntries(Object.entries(readMemo(input, paths)).filter(([key]) => key !== "schemaVersion"));
  writeJsonFile(input.runtime, paths.cache(STATE_FILE), { ...rest, ...change });
};

const notify = (input: HookInput, paths: FmPaths, kind: string, body: string): HookDecision => {
  if (!attentionActive(input, paths, kind)) return allow;
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

const crossedMidnight = (from: string, to: string): boolean =>
  new Date(from).toDateString() !== new Date(to).toDateString();

const rhythm = (input: HookInput, paths: FmPaths, startedAt: string): HookDecision => {
  const hours = loadPerson(input.runtime, paths.root).rhythmHours;
  const now = input.runtime.now();
  const long = hours > 0 && Date.parse(now) - Date.parse(startedAt) > hours * HOUR_MS;
  if (hours === 0 || (!long && !crossedMidnight(startedAt, now))) return allow;
  if (!onceFor(input.runtime, paths, "attention-rhythm.json", input.payload.sessionId ?? "")) return allow;
  if (!attentionActive(input, paths, "rhythm")) return allow;
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
  UserPromptSubmit: [attentionReply, attentionPrompt, attentionTimebox],
};
