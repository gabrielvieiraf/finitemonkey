import { join } from "node:path";

import { CONCEPT_EVENTS_FILE, type ConceptEventKind, type Origin, WEIGHTS } from "../src/conceitos/evidence.js";
import { HORIZON_EVENT } from "../src/signals/blind-band.js";
import { FM_DIR } from "../src/task/paths.js";

const WEEK = 7 * 86_400_000;
const SECOND = 1000;
const SLOTS = 20;

interface Seed {
  readonly weeksAgo: number;
  readonly slot: number;
  readonly concept: string;
  readonly kind: ConceptEventKind;
  readonly origin: Origin;
  readonly task: string;
  readonly file: string;
}

const SEEDS: readonly Seed[] = [
  { weeksAgo: 3, slot: 1, concept: "webhook", kind: "exposure", origin: "agent", task: "t1", file: "src/webhook.ts" },
  {
    weeksAgo: 3,
    slot: 2,
    concept: "idempotency",
    kind: "exposure",
    origin: "agent",
    task: "t1",
    file: "src/payments/charge.ts",
  },
  { weeksAgo: 3, slot: 3, concept: "api", kind: "prediction_right", origin: "person", task: "t1", file: "src/api.ts" },
  {
    weeksAgo: 3,
    slot: 4,
    concept: "migration",
    kind: "own_change",
    origin: "person",
    task: "t1",
    file: "db/001.sql",
  },
  { weeksAgo: 2, slot: 1, concept: "api", kind: "check_right", origin: "person", task: "t2", file: "src/api.ts" },
  { weeksAgo: 2, slot: 2, concept: "api", kind: "prediction_wrong", origin: "person", task: "t2", file: "src/api.ts" },
  {
    weeksAgo: 2,
    slot: 3,
    concept: "migration",
    kind: "own_change",
    origin: "person",
    task: "t2",
    file: "db/002.sql",
  },
  {
    weeksAgo: 1,
    slot: 1,
    concept: "webhook",
    kind: "failure_after_approval",
    origin: "agent",
    task: "t3",
    file: "src/webhook.ts",
  },
  {
    weeksAgo: 0,
    slot: 3,
    concept: "idempotency",
    kind: "failure_after_approval",
    origin: "agent",
    task: "t4",
    file: "src/payments/charge.ts",
  },
  {
    weeksAgo: 0,
    slot: 4,
    concept: "idempotency",
    kind: "own_repair",
    origin: "person",
    task: "t4",
    file: "src/payments/charge.ts",
  },
  {
    weeksAgo: 0,
    slot: 1,
    concept: "migration",
    kind: "own_change",
    origin: "person",
    task: "t4",
    file: "db/003.sql",
  },
  { weeksAgo: 0, slot: 2, concept: "webhook", kind: "exposure", origin: "agent", task: "t4", file: "src/webhook.ts" },
  {
    weeksAgo: 1,
    slot: 4,
    concept: "force-push",
    kind: "prediction_right",
    origin: "person",
    task: "t3",
    file: ".github/workflows/deploy.yml",
  },
];

const HELPS: readonly { readonly weeksAgo: number; readonly criterion: string }[] = [
  { weeksAgo: 2, criterion: "none" },
  { weeksAgo: 2, criterion: "example" },
  { weeksAgo: 1, criterion: "none" },
  { weeksAgo: 0, criterion: "none" },
  { weeksAgo: 0, criterion: "scenario" },
];

const atOf = (now: number, weeksAgo: number, slot: number): string =>
  new Date(now - weeksAgo * WEEK - (SLOTS - slot) * SECOND).toISOString();

const line = (value: Readonly<Record<string, unknown>>): string => `${JSON.stringify(value)}\n`;

const eventsText = (now: number): string =>
  [...SEEDS]
    .sort((a, b) => b.weeksAgo - a.weeksAgo || a.slot - b.slot)
    .map((seed) =>
      line({
        at: atOf(now, seed.weeksAgo, seed.slot),
        concept: seed.concept,
        kind: seed.kind,
        origin: seed.origin,
        task: seed.task,
        file: seed.file,
        weight: WEIGHTS[seed.kind],
      }),
    )
    .join("");

const logText = (now: number): string =>
  HELPS.map((help, index) =>
    line({
      at: atOf(now, help.weeksAgo, 5 + index),
      event: HORIZON_EVENT,
      source: "concept",
      criterion: help.criterion,
      domain: "backend",
      task: `t${String(4 - help.weeksAgo)}`,
    }),
  ).join("");

export const MANUAL_POLICY = "guards:\n  trajectory: active\n";

export const manualTrajectoryFiles = (now: number): Readonly<Record<string, string>> => ({
  [join(FM_DIR, "policy.yml")]: MANUAL_POLICY,
  [join(FM_DIR, CONCEPT_EVENTS_FILE)]: eventsText(now),
  [join(FM_DIR, "log.jsonl")]: logText(now),
});
