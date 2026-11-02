import { accept, isRecord, type Parsed, reject } from "../src/core/parsed.js";
import { derivedSeed, seededRandom, shuffled } from "./bench-plan.js";

export const ARMS = ["plain", "fm"] as const;
export const PROFILES = ["beginner", "experienced"] as const;

export type Arm = (typeof ARMS)[number];
export type Profile = (typeof PROFILES)[number];

export interface Protocol {
  readonly seed: number;
  readonly tasks: readonly string[];
  readonly perProfile: number;
  readonly spares: number;
  readonly timeCapMinutes: number;
}

export interface PlannedSession {
  readonly slot: string;
  readonly position: number;
  readonly task: string;
  readonly arm: Arm;
  readonly taskSeed: number;
}

export interface Slot {
  readonly id: string;
  readonly profile: Profile;
  readonly spare: boolean;
  readonly sessions: readonly PlannedSession[];
}

const PREFIX: Readonly<Record<Profile, string>> = { beginner: "B", experienced: "E" };

const isCount = (value: unknown, min: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min;

const taskList = (value: unknown): Parsed<readonly string[]> => {
  if (!Array.isArray(value)) return reject("tasks must be a list of task family ids");
  const tasks = value.filter((task): task is string => typeof task === "string" && task !== "");
  if (tasks.length !== value.length) return reject("every task must be a non-empty string");
  if (new Set(tasks).size !== tasks.length) return reject("tasks must not repeat");
  if (tasks.length < 2 || tasks.length % 2 !== 0) return reject("tasks must be an even number, at least 2");
  return accept(tasks);
};

export const parseProtocol = (raw: unknown): Parsed<Protocol> => {
  if (!isRecord(raw)) return reject("the protocol must be a JSON object");
  const { seed, perProfile, spares, timeCapMinutes } = raw;
  if (!isCount(seed, 0)) return reject("seed must be a non-negative integer");
  if (!isCount(perProfile, 1)) return reject("perProfile must be a positive integer");
  if (!isCount(spares, 0)) return reject("spares must be a non-negative integer");
  if (!isCount(timeCapMinutes, 1)) return reject("timeCapMinutes must be a positive integer");
  const tasks = taskList(raw["tasks"]);
  if (!tasks.ok) return tasks;
  return accept({ seed, tasks: tasks.value, perProfile, spares, timeCapMinutes });
};

export const slotId = (profile: Profile, index: number): string =>
  `${PREFIX[profile]}${String(index).padStart(2, "0")}`;

const otherArm = (arm: Arm): Arm => (arm === "fm" ? "plain" : "fm");

interface Block {
  readonly key: string;
  readonly member: 0 | 1;
}

const blockOf = (protocol: Protocol, profile: Profile, index: number): Block => {
  const primary = index <= protocol.perProfile;
  const offset = primary ? index : index - protocol.perProfile;
  const size = primary ? protocol.perProfile : protocol.spares;
  const group = primary ? "primary" : "spare";
  if (size % 2 === 1 && offset === size) return { key: `${group}:tail`, member: profile === "beginner" ? 0 : 1 };
  return { key: `${group}:${profile}:${String(Math.floor((offset - 1) / 2))}`, member: (offset - 1) % 2 === 0 ? 0 : 1 };
};

const interleave = (start: Arm, fm: readonly string[], plain: readonly string[]): readonly [string, Arm][] =>
  Array.from({ length: fm.length + plain.length }, (_, position) => {
    const arm = position % 2 === 0 ? start : otherArm(start);
    return [(arm === "fm" ? fm : plain)[Math.floor(position / 2)] ?? "", arm];
  });

export const slotPlan = (protocol: Protocol, profile: Profile, index: number): Slot => {
  const id = slotId(profile, index);
  const block = blockOf(protocol, profile, index);
  const random = seededRandom(derivedSeed(protocol.seed, "block", block.key));
  const drawn = shuffled(protocol.tasks, random);
  const half = drawn.length / 2;
  const takesFirstHalf = (block.member === 0) !== random() < 0.5;
  const start: Arm = (block.member === 0) !== random() < 0.5 ? "fm" : "plain";
  const fmTasks = takesFirstHalf ? drawn.slice(0, half) : drawn.slice(half);
  const plainTasks = takesFirstHalf ? drawn.slice(half) : drawn.slice(0, half);
  const own = seededRandom(derivedSeed(protocol.seed, id, "order"));
  return {
    id,
    profile,
    spare: index > protocol.perProfile,
    sessions: interleave(start, shuffled(fmTasks, own), shuffled(plainTasks, own)).map(([task, arm], position) => ({
      slot: id,
      position: position + 1,
      task,
      arm,
      taskSeed: derivedSeed(protocol.seed, id, task),
    })),
  };
};

export const schedule = (protocol: Protocol): readonly Slot[] =>
  PROFILES.flatMap((profile) =>
    Array.from({ length: protocol.perProfile + protocol.spares }, (_, offset) =>
      slotPlan(protocol, profile, offset + 1),
    ),
  );

export const plannedSession = (
  slots: readonly Slot[],
  slot: string,
  task: string,
): { readonly slot: Slot; readonly session: PlannedSession } | undefined => {
  const found = slots.find((item) => item.id === slot);
  const session = found?.sessions.find((item) => item.task === task);
  return found === undefined || session === undefined ? undefined : { slot: found, session };
};

export interface TaskBalance {
  readonly task: string;
  readonly fm: number;
  readonly plain: number;
}

export const balance = (slots: readonly Slot[], tasks: readonly string[]): readonly TaskBalance[] =>
  tasks.map((task) => {
    const sessions = slots
      .filter((slot) => !slot.spare)
      .flatMap((slot) => slot.sessions.filter((s) => s.task === task));
    return {
      task,
      fm: sessions.filter((session) => session.arm === "fm").length,
      plain: sessions.filter((session) => session.arm === "plain").length,
    };
  });
