import { accept, isRecord, type JsonObject, type Parsed, reject } from "../src/core/parsed.js";
import { type Arm, ARMS, plannedSession, type Profile, PROFILES, type Slot } from "./bench-people-plan.js";

export const STOPS = ["done", "gave-up", "time-cap"] as const;
export type Stop = (typeof STOPS)[number];

export interface FeatureCount {
  readonly shown: number;
  readonly dismissed: number;
}

export interface SessionRecord {
  readonly participant: string;
  readonly task: string;
  readonly assigned: Arm;
  readonly ran: Arm;
  readonly claimedDone: boolean;
  readonly oracleGreen: boolean;
  readonly trapGreen: boolean | null;
  readonly wallSeconds: number;
  readonly tokens: number | null;
  readonly stopped: Stop;
  readonly features: Readonly<Record<string, FeatureCount>>;
}

export interface ParticipantRecord {
  readonly participant: string;
  readonly profile: Profile;
  readonly withdrawn: boolean;
  readonly recordingConsent: boolean;
  readonly perceivedSpeedupPercent: number | null;
}

export interface Dataset {
  readonly synthetic: boolean;
  readonly participants: readonly ParticipantRecord[];
  readonly sessions: readonly SessionRecord[];
}

const pick = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((item) => item === value);

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const features = (value: unknown): Parsed<Readonly<Record<string, FeatureCount>>> => {
  if (!isRecord(value)) return reject("features must be an object of { shown, dismissed } per feature id");
  const entries = Object.entries(value).map(([id, count]) =>
    isRecord(count) && isCount(count["shown"]) && isCount(count["dismissed"]) && count["dismissed"] <= count["shown"]
      ? ([id, { shown: count["shown"], dismissed: count["dismissed"] }] as const)
      : undefined,
  );
  const valid = entries.filter((entry) => entry !== undefined);
  return valid.length === entries.length
    ? accept(Object.fromEntries(valid))
    : reject("each feature needs integer shown and dismissed, with dismissed at most shown");
};

const nullable = <T>(value: unknown, guard: (item: unknown) => item is T): T | null | undefined =>
  value === null ? null : guard(value) ? value : undefined;

const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const parseSession = (raw: JsonObject, slots: readonly Slot[]): Parsed<SessionRecord> => {
  const { participant, task, claimedDone, oracleGreen, wallSeconds } = raw;
  if (typeof participant !== "string" || typeof task !== "string") return reject("participant and task are required");
  const planned = plannedSession(slots, participant, task);
  if (planned === undefined) return reject(`${participant} has no scheduled session for ${task}`);
  const ran = pick(ARMS, raw["arm"]);
  const stopped = pick(STOPS, raw["stopped"]);
  const trapGreen = nullable(raw["trapGreen"], isBool);
  const tokens = nullable(raw["tokens"], isCount);
  if (ran === undefined) return reject(`arm must be one of ${ARMS.join(", ")}`);
  if (stopped === undefined) return reject(`stopped must be one of ${STOPS.join(", ")}`);
  if (!isBool(claimedDone) || !isBool(oracleGreen)) return reject("claimedDone and oracleGreen must be booleans");
  if (trapGreen === undefined) return reject("trapGreen must be a boolean or null");
  if (!isNumber(wallSeconds) || wallSeconds <= 0) return reject("wallSeconds must be a positive number");
  if (tokens === undefined) return reject("tokens must be a non-negative integer or null");
  const counts = features(raw["features"] ?? {});
  if (!counts.ok) return counts;
  return accept({
    participant,
    task,
    assigned: planned.session.arm,
    ran,
    claimedDone,
    oracleGreen,
    trapGreen,
    wallSeconds,
    tokens,
    stopped,
    features: counts.value,
  });
};

export const parseParticipant = (raw: JsonObject, slots: readonly Slot[]): Parsed<ParticipantRecord> => {
  const { participant, withdrawn, recordingConsent } = raw;
  const slot = slots.find((item) => item.id === participant);
  if (typeof participant !== "string" || slot === undefined) return reject("participant must be a scheduled slot id");
  const profile = pick(PROFILES, raw["profile"]);
  if (profile !== slot.profile) return reject(`${participant} is a ${slot.profile} slot`);
  if (!isBool(withdrawn) || !isBool(recordingConsent)) return reject("withdrawn and recordingConsent must be booleans");
  const perceived = nullable(raw["perceivedSpeedupPercent"], isNumber);
  if (perceived === undefined) return reject("perceivedSpeedupPercent must be a number or null");
  return accept({ participant, profile, withdrawn, recordingConsent, perceivedSpeedupPercent: perceived });
};

const parseAll = <T>(
  label: string,
  rows: readonly JsonObject[],
  parse: (row: JsonObject) => Parsed<T>,
): { readonly items: readonly T[]; readonly errors: readonly string[] } => {
  const results = rows.map((row, index) => ({ index, result: parse(row) }));
  return {
    items: results.flatMap(({ result }) => (result.ok ? [result.value] : [])),
    errors: results.flatMap(({ index, result }) =>
      result.ok ? [] : [`${label} line ${String(index + 1)}: ${result.error}`],
    ),
  };
};

const syntheticFlag = (rows: readonly JsonObject[]): Parsed<boolean> => {
  const flags = new Set(rows.map((row) => row["synthetic"]));
  if ([...flags].some((flag) => typeof flag !== "boolean"))
    return reject("every record must carry synthetic: true or false");
  if (flags.size !== 1) return reject("synthetic and real records must never be mixed");
  return accept(flags.has(true));
};

const duplicates = (keys: readonly string[]): readonly string[] =>
  [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))].map((key) => `duplicate record ${key}`);

export const parseDataset = (
  participantRows: readonly JsonObject[],
  sessionRows: readonly JsonObject[],
  slots: readonly Slot[],
): Parsed<Dataset, readonly string[]> => {
  const flag = syntheticFlag([...participantRows, ...sessionRows]);
  if (!flag.ok) return reject([flag.error]);
  const people = parseAll("participants", participantRows, (row) => parseParticipant(row, slots));
  const sessions = parseAll("sessions", sessionRows, (row) => parseSession(row, slots));
  const known = new Set(people.items.map((item) => item.participant));
  const withdrawn = new Set(people.items.filter((item) => item.withdrawn).map((item) => item.participant));
  const errors = [
    ...people.errors,
    ...sessions.errors,
    ...duplicates(people.items.map((item) => item.participant)),
    ...duplicates(sessions.items.map((item) => `${item.participant}/${item.task}`)),
    ...sessions.items
      .filter((item) => !known.has(item.participant))
      .map((item) => `${item.participant} has no participant record`),
    ...[
      ...new Set(sessions.items.filter((item) => withdrawn.has(item.participant)).map((item) => item.participant)),
    ].map((participant) => `${participant} withdrew: delete their sessions, keep only the participant record`),
  ];
  return errors.length > 0
    ? reject(errors)
    : accept({ synthetic: flag.value, participants: people.items, sessions: sessions.items });
};
