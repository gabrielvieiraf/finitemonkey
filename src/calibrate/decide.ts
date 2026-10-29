import type { CalibrateConfig } from "../policy/policy.js";
import { type Inputs, vectorOf } from "./inputs.js";
import { type Logistic, predict } from "./model.js";

export const STATES = ["run", "ask", "abstain"] as const;

export type CalibratedState = (typeof STATES)[number];

export const COLORS: Readonly<Record<CalibratedState, string>> = { run: "green", ask: "yellow", abstain: "red" };

export interface Decision {
  readonly state: CalibratedState;
  readonly by: "rules" | "model";
  readonly inputs: Inputs;
  readonly probability?: number;
}

export const fixedRule = (inputs: Inputs): CalibratedState => (inputs.divergence > 0 ? "ask" : "run");

export const decide = (inputs: Inputs, model: Logistic | undefined, config: CalibrateConfig): Decision => {
  if (model === undefined) return { state: fixedRule(inputs), by: "rules", inputs };
  const probability = predict(model, vectorOf(inputs));
  const state: CalibratedState =
    probability >= config.abstainAbove ? "abstain" : probability >= config.askAbove ? "ask" : "run";
  return { state, by: "model", inputs, probability };
};
