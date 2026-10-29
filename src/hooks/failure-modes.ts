import type { GuardSet } from "../policy/guards.js";
import { GUARD_SETS } from "./handlers.js";

export type FailureMode = "closed" | "open";

export interface GuardFailureMode {
  readonly guard: string;
  readonly mode: FailureMode;
}

export const failureModeOf = (set: Pick<GuardSet, "damage">): FailureMode => (set.damage ? "closed" : "open");

export const guardFailureModes = (sets: readonly GuardSet[] = GUARD_SETS): readonly GuardFailureMode[] =>
  sets.map((set) => ({ guard: set.id, mode: failureModeOf(set) }));
