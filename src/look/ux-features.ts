import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { featureMode } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { A11Y_FEATURE, A11Y_VIEWPORTS } from "./a11y.js";
import type { LookConfig } from "./config.js";
import { activeUiScreens, contractDialogs, contractStates, UI_CONTRACT_FEATURE } from "./contract.js";
import { readDont } from "./dont.js";
import { KEYBOARD_FEATURE } from "./keyboard.js";
import { contractPass } from "./node-contract.js";
import { keyboardPass } from "./node-keyboard.js";
import { statesPass } from "./node-states.js";
import { a11yPass, loadAxeSource, type PagePass } from "./node-ux.js";
import { optionsOf, STATES_FEATURE } from "./states.js";
import { VIEWPORTS } from "./types.js";

export const UX_FEATURES = [A11Y_FEATURE, KEYBOARD_FEATURE, STATES_FEATURE, UI_CONTRACT_FEATURE] as const;

export type ModeMap = Readonly<Record<string, GuardMode>>;

export const activeModes = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): ModeMap =>
  Object.fromEntries(UX_FEATURES.map((feature) => [feature, featureMode(runtime, paths, feature)]));

const on = (modes: ModeMap, feature: string): boolean => (modes[feature] ?? "off") !== "off";

export const uxWidths = (modes: ModeMap): readonly number[] => (on(modes, A11Y_FEATURE) ? A11Y_VIEWPORTS : []);

export const uxPasses = (
  runtime: Runtime,
  root: AbsolutePath,
  config: LookConfig,
  modes: ModeMap,
): readonly PagePass[] => {
  const paths = fmPaths(root);
  const contract = on(modes, UI_CONTRACT_FEATURE);
  const screens = contract ? activeUiScreens(runtime, paths) : [];
  const dont = contract ? readDont(runtime, paths) : [];
  const widest = Math.max(...VIEWPORTS);
  const states = contractStates(screens, config.states);
  return [
    ...(on(modes, A11Y_FEATURE) ? [a11yPass({ target: config.a11yTarget }, loadAxeSource(root), widest)] : []),
    ...(contract && dont.length > 0 ? [contractPass(dont, widest)] : []),
    ...(on(modes, KEYBOARD_FEATURE) ? [keyboardPass(contractDialogs(screens, config.dialogs))] : []),
    ...(on(modes, STATES_FEATURE) ? [statesPass(states, optionsOf(config.successColor, config.skeleton))] : []),
  ];
};
