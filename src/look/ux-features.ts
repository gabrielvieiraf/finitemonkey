import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { addedLines, gitAt, resolveBase, untracked } from "../gate/git.js";
import { featureMode } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { A11Y_FEATURE, A11Y_VIEWPORTS } from "./a11y.js";
import type { LookConfig } from "./config.js";
import {
  activeUiScreens,
  contractDialogs,
  contractForms,
  contractStates,
  UI_CONTRACT_FEATURE,
  type UiScreen,
} from "./contract.js";
import { readDont } from "./dont.js";
import { DEFAULT_LOOK_FEATURE, DS_FEATURE } from "./ds.js";
import { type AddedText, staticPages } from "./ds-static.js";
import { FLOW_FEATURE } from "./flow.js";
import { FORMS_FEATURE } from "./forms.js";
import { JOURNEYS_FEATURE } from "./journey.js";
import { KEYBOARD_FEATURE } from "./keyboard.js";
import { contractPass } from "./node-contract.js";
import { defaultLookPass, type DsOptions, dsPass } from "./node-ds.js";
import { formsPass } from "./node-forms.js";
import { keyboardPass } from "./node-keyboard.js";
import { statesPass } from "./node-states.js";
import { a11yPass, loadAxeSource, type PagePass } from "./node-ux.js";
import { lookDir } from "./paths.js";
import { optionsOf, STATES_FEATURE } from "./states.js";
import { EMPTY_TOKENS, loadTokens, type TokenSet } from "./tokens.js";
import { VIEWPORTS } from "./types.js";
import type { UxPage } from "./ux.js";
import { VISUAL_FEATURE } from "./visual.js";

export const UX_FEATURES = [
  A11Y_FEATURE,
  KEYBOARD_FEATURE,
  STATES_FEATURE,
  UI_CONTRACT_FEATURE,
  DS_FEATURE,
  DEFAULT_LOOK_FEATURE,
  FORMS_FEATURE,
  FLOW_FEATURE,
  JOURNEYS_FEATURE,
  VISUAL_FEATURE,
] as const;

export type ModeMap = Readonly<Record<string, GuardMode>>;

export const activeModes = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): ModeMap =>
  Object.fromEntries(UX_FEATURES.map((feature) => [feature, featureMode(runtime, paths, feature)]));

const on = (modes: ModeMap, feature: string): boolean => (modes[feature] ?? "off") !== "off";

export const uxWidths = (modes: ModeMap): readonly number[] => (on(modes, A11Y_FEATURE) ? A11Y_VIEWPORTS : []);

export interface UxSetup {
  readonly screens: readonly UiScreen[];
  readonly tokens: TokenSet;
  readonly tokenFiles: readonly string[];
}

export const uxSetup = (runtime: Runtime, root: AbsolutePath, config: LookConfig, modes: ModeMap): UxSetup => {
  const screens = activeUiScreens(runtime, fmPaths(root));
  const tokenFiles = [...new Set([...config.ds.tokens, ...screens.flatMap((screen) => screen.tokens ?? [])])];
  const wanted = on(modes, DS_FEATURE) || on(modes, DEFAULT_LOOK_FEATURE);
  return { screens, tokenFiles, tokens: wanted ? loadTokens(runtime, root, tokenFiles) : EMPTY_TOKENS };
};

const dsOptions = (root: AbsolutePath, config: LookConfig, setup: UxSetup, tree: string): DsOptions => ({
  tokens: setup.tokens,
  exclude: config.ds.exclude,
  proposal: join(lookDir(fmPaths(root), tree), "tokens.proposed.json"),
  widest: Math.max(...VIEWPORTS),
  tolerance: config.ds.tolerance,
});

export const uxPasses = (
  runtime: Runtime,
  root: AbsolutePath,
  config: LookConfig,
  modes: ModeMap,
  tree: string,
): readonly PagePass[] => {
  const setup = uxSetup(runtime, root, config, modes);
  const dont = on(modes, UI_CONTRACT_FEATURE) ? readDont(runtime, fmPaths(root)) : [];
  const widest = Math.max(...VIEWPORTS);
  const ds = dsOptions(root, config, setup, tree);
  return [
    ...(on(modes, A11Y_FEATURE) ? [a11yPass({ target: config.a11yTarget }, loadAxeSource(root), widest)] : []),
    ...(dont.length > 0 ? [contractPass(dont, widest)] : []),
    ...(on(modes, DS_FEATURE) ? [dsPass(ds)] : []),
    ...(on(modes, DEFAULT_LOOK_FEATURE) ? [defaultLookPass(ds)] : []),
    ...(on(modes, KEYBOARD_FEATURE) ? [keyboardPass(contractDialogs(setup.screens, config.dialogs))] : []),
    ...(on(modes, FORMS_FEATURE)
      ? [
          formsPass({
            forms: contractForms(setup.screens, config.forms),
            keepCleared: config.formsKeepCleared,
            values: config.formValues,
            widest,
          }),
        ]
      : []),
    ...(on(modes, STATES_FEATURE)
      ? [statesPass(contractStates(setup.screens, config.states), optionsOf(config.successColor, config.skeleton))]
      : []),
  ];
};

const addedText = (runtime: Runtime, root: AbsolutePath): readonly AddedText[] => {
  const git = gitAt(runtime, root);
  const tracked = addedLines(git, resolveBase(git, undefined));
  const fresh = untracked(git).flatMap((file) => {
    const text = runtime.readText(toAbsolutePath(join(root, file)));
    return text.ok ? text.value.split("\n").map((line, index) => ({ path: file, line: index + 1, text: line })) : [];
  });
  return [...tracked, ...fresh];
};

export const uxStaticPages = (
  runtime: Runtime,
  root: AbsolutePath,
  config: LookConfig,
  modes: ModeMap,
): readonly UxPage[] => {
  if (!on(modes, DS_FEATURE)) return [];
  const setup = uxSetup(runtime, root, config, modes);
  return staticPages(addedText(runtime, root), setup.tokens, {
    screens: config.screens,
    tokenFiles: setup.tokenFiles,
    excludeFiles: config.ds.excludeFiles,
  });
};
