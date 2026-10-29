import { completionClaim } from "../src/claims/detect.js";
import { accept, isRecord, type JsonObject, type Parsed, reject } from "../src/core/parsed.js";
import type { Intents } from "./bench-family.js";
import { renderText } from "./bench-render.js";
import { jsonLines } from "./bench-transcript.js";

export const SITUATIONS = ["secret", "destructive", "claimed-done", "question", "blocked", "other"] as const;
export const KINDS = ["answer", "approve", "decline", "refuse", "ask-evidence", "end"] as const;
export const OBSERVATIONS = ["final-message", "commands"] as const;

export type Situation = (typeof SITUATIONS)[number];
export type ReactionKind = (typeof KINDS)[number];
export type Observation = (typeof OBSERVATIONS)[number];

export interface Reaction {
  readonly kind: ReactionKind;
  readonly reply: string;
  readonly unlessTestsRan: boolean;
}

export interface Behavior {
  readonly observes: readonly Observation[];
  readonly maxFollowUps: number;
  readonly reactions: Readonly<Record<Situation, Reaction>>;
}

const PLACEHOLDER = /\{\{([a-zA-Z]+)\}\}/g;
const ALLOWED_PLACEHOLDERS: ReadonlySet<string> = new Set(["goal", "acceptance", "constraints"]);
const NEEDS_REPLY: ReadonlySet<ReactionKind> = new Set(["answer", "approve", "decline", "refuse", "ask-evidence"]);

const reactionOf = (id: string, situation: Situation, raw: unknown, observes: readonly Observation[]) => {
  if (!isRecord(raw)) return reject(`${id}: reaction for ${situation} is missing`);
  const kind = KINDS.find((option) => option === raw["kind"]);
  if (kind === undefined) return reject(`${id}: ${situation} needs a kind of ${KINDS.join(", ")}`);
  const reply = typeof raw["reply"] === "string" ? raw["reply"] : "";
  if (NEEDS_REPLY.has(kind) && reply.trim() === "") return reject(`${id}: ${situation} needs a reply`);
  const unknown = [...reply.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? "")
    .filter((name) => !ALLOWED_PLACEHOLDERS.has(name));
  if (unknown.length > 0)
    return reject(`${id}: ${situation} may only quote the task intents, not ${unknown.join(", ")}`);
  const unlessTestsRan = raw["unlessTestsRan"] === true;
  if (unlessTestsRan && !observes.includes("commands")) {
    return reject(`${id}: ${situation} reacts to test runs the persona does not observe`);
  }
  if (situation === "secret" && kind !== "refuse") return reject(`${id}: a simulated person never hands over a secret`);
  return accept({ kind, reply, unlessTestsRan });
};

export const parseBehavior = (id: string, record: JsonObject): Parsed<Behavior> => {
  const observesRaw = record["observes"];
  const observes = Array.isArray(observesRaw)
    ? observesRaw.flatMap((item) => OBSERVATIONS.filter((option) => option === item))
    : [];
  if (!Array.isArray(observesRaw) || observes.length !== observesRaw.length || !observes.includes("final-message")) {
    return reject(`${id}: observes must list final-message and optionally commands`);
  }
  const maxFollowUps = record["maxFollowUps"];
  if (typeof maxFollowUps !== "number" || !Number.isInteger(maxFollowUps) || maxFollowUps < 0) {
    return reject(`${id}: maxFollowUps must be a whole number`);
  }
  const table = isRecord(record["reactions"]) ? record["reactions"] : {};
  const reactions: Partial<Record<Situation, Reaction>> = {};
  for (const situation of SITUATIONS) {
    const reaction = reactionOf(id, situation, table[situation], observes);
    if (!reaction.ok) return reaction;
    reactions[situation] = reaction.value;
  }
  const { secret, destructive, question, blocked, other } = reactions;
  const done = reactions["claimed-done"];
  if (secret === undefined || destructive === undefined || question === undefined) return reject(`${id}: incomplete`);
  if (blocked === undefined || other === undefined || done === undefined) return reject(`${id}: incomplete`);
  return accept({
    observes,
    maxFollowUps,
    reactions: { secret, destructive, "claimed-done": done, question, blocked, other },
  });
};

const SECRET = /\b(?:api[ _-]?key|token|password|secret|credentials?)\b/i;
const HANDOVER = /\?|\b(?:provide|share|paste|send|give me)\b/i;
const DESTRUCTIVE = /\b(?:delete|remove|drop|overwrite|wipe|force[- ]push|reset --hard|rm -rf|discard)\b/i;
const ASKING = /\?|\b(?:should I|do you want|confirm|ok to|okay to|shall I)\b/i;
const BLOCKED = /\b(?:can't|cannot|unable to|could not|couldn't|blocked|stuck)\b/i;

export const situationOf = (message: string): Situation => {
  const text = message.trim();
  const tail = text.slice(-400);
  if (SECRET.test(tail) && HANDOVER.test(tail)) return "secret";
  if (DESTRUCTIVE.test(tail) && ASKING.test(tail)) return "destructive";
  if (completionClaim(text) !== undefined) return "claimed-done";
  if (tail.includes("?")) return "question";
  if (BLOCKED.test(tail)) return "blocked";
  return "other";
};

const TEST_COMMAND = /\b(?:npm (?:run )?test|npm t\b|node --test|vitest|jest|pytest|go test|cargo test)\b/;

export interface View {
  readonly finalMessage: string;
  readonly testsRan: boolean | undefined;
}

export const observe = (observes: readonly Observation[], transcript: string): View => {
  const lines = jsonLines(transcript);
  const result = lines.findLast((line) => line["type"] === "result")?.["result"];
  const commands = lines.flatMap((line) => {
    const message = line["message"];
    const content = isRecord(message) ? message["content"] : undefined;
    if (!Array.isArray(content)) return [];
    return content.flatMap((block) => {
      if (!isRecord(block) || block["type"] !== "tool_use" || block["name"] !== "Bash") return [];
      const input = block["input"];
      const command = isRecord(input) ? input["command"] : undefined;
      return typeof command === "string" ? [command] : [];
    });
  });
  return {
    finalMessage: typeof result === "string" ? result : "",
    testsRan: observes.includes("commands") ? commands.some((command) => TEST_COMMAND.test(command)) : undefined,
  };
};

export interface Turn {
  readonly situation: Situation;
  readonly kind: ReactionKind;
  readonly reply: string | undefined;
}

export const react = (behavior: Behavior, intents: Intents, view: View): Turn => {
  const situation = situationOf(view.finalMessage);
  const reaction = behavior.reactions[situation];
  const satisfied = reaction.unlessTestsRan && view.testsRan === true;
  if (reaction.kind === "end" || satisfied)
    return { situation, kind: satisfied ? "end" : reaction.kind, reply: undefined };
  const reply = renderText(reaction.reply, { ...intents })
    .replace(/\s+/g, " ")
    .trim();
  return { situation, kind: reaction.kind, reply };
};

export const followUp = (behavior: Behavior, intents: Intents, transcript: string, turn: number): string | undefined =>
  turn >= behavior.maxFollowUps ? undefined : react(behavior, intents, observe(behavior.observes, transcript)).reply;
