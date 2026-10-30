import { accept, type Parsed, reject } from "../core/parsed.js";
import {
  COMPLETION_STATES,
  type CompletionState,
  type Evidence,
  EVIDENCE_SCHEMA,
  type EvidenceStatus,
  type UnverifiedReason,
} from "../evidence/types.js";

export { COMPLETION_STATES, type CompletionState };

export const STATE_CHECK = "*state*";

const RESULTS = ["verified", "partial", "failed", "needs_approval"] as const satisfies readonly CompletionState[];

export const TRANSITIONS: Readonly<Record<CompletionState, readonly CompletionState[]>> = {
  unverified: ["running", "blocked", "inconclusive"],
  running: ["verified", "partial", "failed", "needs_approval", "blocked", "inconclusive"],
  verified: ["running", "invalidated", "blocked", "inconclusive"],
  partial: ["running", "invalidated", "blocked", "inconclusive"],
  failed: ["running", "invalidated", "blocked", "inconclusive"],
  needs_approval: ["running", "invalidated", "blocked", "inconclusive"],
  invalidated: ["running", "blocked", "inconclusive"],
  blocked: ["running", "inconclusive"],
  inconclusive: ["running", "blocked"],
};

export const APPROVAL_REASONS: readonly UnverifiedReason[] = ["awaiting_person", "untrusted", "needs_approval"];

export interface Transition {
  readonly from: CompletionState;
  readonly to: CompletionState;
  readonly reason: string;
}

export const transition = (from: CompletionState, to: CompletionState, reason: string): Parsed<Transition> =>
  TRANSITIONS[from].includes(to) && reason.trim() !== ""
    ? accept({ from, to, reason })
    : reject(`${from} -> ${to} is not an allowed transition`);

export const canClose = (state: CompletionState): boolean => state === "verified";

export interface StateItem {
  readonly id: string;
  readonly status: EvidenceStatus;
  readonly reason?: UnverifiedReason;
}

export interface Outcome {
  readonly state: CompletionState;
  readonly reason: string;
}

const listed = (items: readonly StateItem[]): string =>
  items.map((item) => (item.reason === undefined ? item.id : `${item.id}(${item.reason})`)).join(",");

export const outcomeState = (items: readonly StateItem[]): Outcome => {
  const failing = items.filter((item) => item.status === "failed");
  if (failing.length > 0) return { state: "failed", reason: `failed:${listed(failing)}` };
  const open = items.filter((item) => item.status === "unverified");
  if (open.length === 0) return { state: "verified", reason: `verified:${String(items.length)}` };
  const waiting = open.some((item) => item.reason !== undefined && APPROVAL_REASONS.includes(item.reason));
  return { state: waiting ? "needs_approval" : "partial", reason: `unverified:${listed(open)}` };
};

const STATUS_OF: Readonly<Record<CompletionState, EvidenceStatus>> = {
  unverified: "unverified",
  running: "unverified",
  verified: "passed",
  partial: "unverified",
  invalidated: "unverified",
  blocked: "unverified",
  failed: "failed",
  inconclusive: "unverified",
  needs_approval: "unverified",
};

export const lastState = (ledger: readonly Evidence[], task: string): Evidence | undefined =>
  ledger.findLast((entry) => entry.task === task && entry.check === STATE_CHECK && entry.state !== undefined);

export interface StateStamp {
  readonly task: string;
  readonly treeHash: string;
  readonly at: string;
}

const isResult = (state: CompletionState): boolean => RESULTS.some((item) => item === state);

export const plannedSteps = (prior: Evidence | undefined, treeHash: string, outcome: Outcome): readonly Outcome[] => {
  const from = prior?.state ?? "unverified";
  return [
    ...(from === "running" ? [{ state: "inconclusive" as const, reason: "previous run did not finish" }] : []),
    ...(prior !== undefined && prior.treeHash !== treeHash && isResult(from)
      ? [{ state: "invalidated" as const, reason: `tree:${prior.treeHash}->${treeHash}` }]
      : []),
    { state: "running", reason: "gate run" },
    outcome,
  ];
};

export const chain = (from: CompletionState, steps: readonly Outcome[]): Parsed<readonly Transition[]> => {
  const done: Transition[] = [];
  let current = from;
  for (const step of steps) {
    const next = transition(current, step.state, step.reason);
    if (!next.ok) return next;
    done.push(next.value);
    current = step.state;
  }
  return accept(done);
};

export const stateEntry = (stamp: StateStamp, step: Transition): Evidence => ({
  schema: EVIDENCE_SCHEMA,
  task: stamp.task,
  check: STATE_CHECK,
  kind: "state",
  status: STATUS_OF[step.to],
  treeHash: stamp.treeHash,
  at: stamp.at,
  notes: [],
  state: step.to,
  from: step.from,
  stateReason: step.reason,
});

export const stateEntries = (ledger: readonly Evidence[], stamp: StateStamp, outcome: Outcome): readonly Evidence[] => {
  const prior = lastState(ledger, stamp.task);
  const steps = chain(prior?.state ?? "unverified", plannedSteps(prior, stamp.treeHash, outcome));
  return steps.ok ? steps.value.map((step) => stateEntry(stamp, step)) : [];
};
