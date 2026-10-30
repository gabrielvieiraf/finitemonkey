import { approvals, guards } from "./threat-model-guards.js";
import { hooks, ledger, mod } from "./threat-model-hooks.js";
import { claims, knowledge, network, unattended } from "./threat-model-knowledge.js";

export const ATTACKERS = [
  "mistaken agent",
  "misread requirement",
  "looping agent",
  "bypassing agent",
  "injected content",
  "concurrent process",
  "compromised dependency",
  "wrong tool output",
  "inconsistent policy",
  "over-privileged process",
  "process able to edit the guard",
] as const;

export type Attacker = (typeof ATTACKERS)[number];

export const OUTCOMES = ["prevented", "detected", "recorded", "reduced", "not covered"] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const COMPONENTS = [
  "Command hooks",
  "The mod",
  "Signed ledger and its key",
  "Contracts and approvals",
  "Guards",
  "Quarantine of external content and memory",
  "Claims",
  "Unattended runs",
  "Network use",
] as const;

export type Component = (typeof COMPONENTS)[number];

export interface Proof {
  readonly file: string;
  readonly test: string;
}

export interface Threat {
  readonly component: Component;
  readonly attacker: Attacker;
  readonly threat: string;
  readonly outcome: Outcome;
  readonly mechanism: string;
  readonly code: readonly string[];
  readonly proof?: Proof;
}

export const THREATS: readonly Threat[] = [
  ...hooks,
  ...mod,
  ...ledger,
  ...approvals,
  ...guards,
  ...knowledge,
  ...claims,
  ...unattended,
  ...network,
];
