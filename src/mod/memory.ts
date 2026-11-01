import type { DomainTrajectory, Mark } from "../conceitos/trajectory.js";
import type { ThemeChoice } from "../conceitos/trajectory-palette.js";
import type { Timer } from "./api.js";
import type { ContractView, DivergeView } from "./approve-view.js";
import type { LoadedState } from "./state.js";
import type { GateView } from "./status.js";
import type { ProbeCard, TeachCard } from "./teach-view.js";
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
  teachCard: TeachCard | undefined;
  probeCard: ProbeCard | undefined;
  teachNotice: string | undefined;
  trajectory: readonly DomainTrajectory[];
  selectedMark: Mark | undefined;
  theme: ThemeChoice;
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
  teachCard: undefined,
  probeCard: undefined,
  teachNotice: undefined,
  trajectory: [],
  selectedMark: undefined,
  theme: "auto",
};
