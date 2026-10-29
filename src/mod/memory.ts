import type { Timer } from "./api.js";
import type { ContractView, DivergeView } from "./approve-view.js";
import type { LoadedState } from "./state.js";
import type { GateView } from "./status.js";
import type { ConceptRow, XrayView } from "./xray-view.js";

export interface StepUsage {
  readonly model: string;
  readonly agent: string | null;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface Memory {
  state: LoadedState | undefined;
  view: GateView | undefined;
  pending: Timer | undefined;
  steps: readonly StepUsage[];
  cost: readonly string[];
  board: readonly string[];
  contract: ContractView | undefined;
  divergence: DivergeView | undefined;
  notice: string | undefined;
  xray: XrayView | undefined;
  concepts: readonly ConceptRow[];
}

export const memory: Memory = {
  state: undefined,
  view: undefined,
  pending: undefined,
  steps: [],
  cost: [],
  board: [],
  contract: undefined,
  divergence: undefined,
  notice: undefined,
  xray: undefined,
  concepts: [],
};
