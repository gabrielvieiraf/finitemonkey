import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import { readDecisions } from "../guardian/decisions.js";
import type { Translate } from "../i18n/translate.js";
import type { FmPaths } from "../task/paths.js";
import type { TaskContract } from "../task/types.js";

export const GATE_COMMAND = "npx finitemonkey gate";

export type NextAction =
  | { readonly kind: "reproduce"; readonly check: string; readonly command: string }
  | { readonly kind: "decide"; readonly id: string; readonly subject: string }
  | { readonly kind: "gate" };

export interface Failure {
  readonly check: string;
  readonly command: string;
}

export interface FocusCard {
  readonly task: string;
  readonly goal: string;
  readonly green: readonly string[];
  readonly red: readonly string[];
  readonly open: readonly string[];
  readonly lastFailure: Failure | undefined;
  readonly next: NextAction;
}

export interface PendingDecision {
  readonly id: string;
  readonly subject: string;
}

const latest = (entries: readonly Evidence[], check: string): Evidence | undefined =>
  entries.findLast((entry) => entry.check === check);

const commandFor = (contract: TaskContract, entry: Evidence): string =>
  entry.command ?? contract.acceptance.find((item) => item.id === entry.check)?.run ?? GATE_COMMAND;

const nextAction = (
  contract: TaskContract,
  entries: readonly Evidence[],
  red: readonly string[],
  decision: PendingDecision | undefined,
): NextAction => {
  const first = red[0];
  const entry = first === undefined ? undefined : latest(entries, first);
  if (first !== undefined && entry !== undefined) {
    return { kind: "reproduce", check: first, command: commandFor(contract, entry) };
  }
  return decision === undefined ? { kind: "gate" } : { kind: "decide", id: decision.id, subject: decision.subject };
};

export const buildCard = (
  contract: TaskContract,
  entries: readonly Evidence[],
  decision: PendingDecision | undefined,
): FocusCard => {
  const states = contract.acceptance.map((item) => [item.id, latest(entries, item.id)?.status] as const);
  const red = states.flatMap(([id, status]) => (status === "failed" ? [id] : []));
  const failed = entries.findLast((entry) => entry.status === "failed" && entry.check !== GATE_CHECK);
  return {
    task: contract.id,
    goal: contract.goal,
    green: states.flatMap(([id, status]) => (status === "passed" ? [id] : [])),
    red,
    open: states.flatMap(([id, status]) => (status === "passed" || status === "failed" ? [] : [id])),
    lastFailure: failed === undefined ? undefined : { check: failed.check, command: commandFor(contract, failed) },
    next: nextAction(contract, entries, red, decision),
  };
};

export const pendingDecision = (runtime: Pick<Runtime, "readText">, paths: FmPaths): PendingDecision | undefined => {
  const found = readDecisions(runtime, paths).find((entry) => entry.decision === "pending");
  return found === undefined ? undefined : { id: found.id, subject: found.subject };
};

export const cardFor = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  contract: TaskContract,
): FocusCard => buildCard(contract, readLedger(runtime, paths.evidence(contract.id)), pendingDecision(runtime, paths));

const list = (items: readonly string[]): string => (items.length === 0 ? "-" : items.join(", "));

const nextLine = (t: Translate, next: NextAction): string => {
  if (next.kind === "reproduce") return t("focus.card.next.reproduce", { check: next.check, command: next.command });
  if (next.kind === "decide") return t("focus.card.next.decide", { id: next.id, subject: next.subject });
  return t("focus.card.next.gate", { command: GATE_COMMAND });
};

export const cardLines = (t: Translate, card: FocusCard): readonly string[] => [
  t("focus.card.title", { task: card.task, goal: card.goal }),
  t("focus.card.criteria", { green: list(card.green), red: list(card.red), open: list(card.open) }),
  ...(card.lastFailure === undefined
    ? []
    : [t("focus.card.failure", { check: card.lastFailure.check, command: card.lastFailure.command })]),
  nextLine(t, card.next),
];
