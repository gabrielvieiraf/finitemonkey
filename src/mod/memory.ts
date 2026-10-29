import type { Timer } from "./api.js";
import type { LoadedState } from "./state.js";
import type { GateView } from "./status.js";

export interface Memory {
  state: LoadedState | undefined;
  view: GateView | undefined;
  pending: Timer | undefined;
}

export const memory: Memory = { state: undefined, view: undefined, pending: undefined };
