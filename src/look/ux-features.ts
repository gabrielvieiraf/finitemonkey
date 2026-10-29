import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { featureMode } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { A11Y_FEATURE, A11Y_VIEWPORTS } from "./a11y.js";
import type { LookConfig } from "./config.js";
import { a11yPass, loadAxeSource, type PagePass } from "./node-ux.js";
import { VIEWPORTS } from "./types.js";

export const UX_FEATURES = [A11Y_FEATURE] as const;

export type ModeMap = Readonly<Record<string, GuardMode>>;

export const activeModes = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): ModeMap =>
  Object.fromEntries(UX_FEATURES.map((feature) => [feature, featureMode(runtime, paths, feature)]));

const on = (modes: ModeMap, feature: string): boolean => (modes[feature] ?? "off") !== "off";

export const uxWidths = (modes: ModeMap): readonly number[] => (on(modes, A11Y_FEATURE) ? A11Y_VIEWPORTS : []);

export const uxPasses = (
  _runtime: Runtime,
  root: AbsolutePath,
  config: LookConfig,
  modes: ModeMap,
): readonly PagePass[] => [
  ...(on(modes, A11Y_FEATURE)
    ? [a11yPass({ target: config.a11yTarget }, loadAxeSource(root), Math.max(...VIEWPORTS))]
    : []),
];
