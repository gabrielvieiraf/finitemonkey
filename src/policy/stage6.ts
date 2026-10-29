import { configMap, type ConfigTree } from "../git/project-config.js";

export const DEFAULT_EVOLVE_MIN_TASKS = 10;
export const EVOLVE_KEYS: readonly string[] = ["minTasks"];

export interface EvolveConfig {
  readonly minTasks: number;
}

export const parseEvolve = (tree: ConfigTree): EvolveConfig => {
  const raw = Number(configMap(tree, "evolve")["minTasks"]);
  return { minTasks: Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_EVOLVE_MIN_TASKS };
};

export const CALIBRATE_KEYS: readonly string[] = ["minLabels", "askAbove", "abstainAbove"];

export interface CalibrateConfig {
  readonly minLabels: number;
  readonly askAbove: number;
  readonly abstainAbove: number;
}

export const DEFAULT_CALIBRATE: CalibrateConfig = { minLabels: 30, askAbove: 0.25, abstainAbove: 0.6 };

const share = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) && value > 0 && value < 1 ? value : fallback;
};

export const parseCalibrate = (tree: ConfigTree): CalibrateConfig => {
  const raw = configMap(tree, "calibrate");
  const min = Number(raw["minLabels"]);
  const askAbove = share(raw["askAbove"], DEFAULT_CALIBRATE.askAbove);
  const abstainAbove = share(raw["abstainAbove"], DEFAULT_CALIBRATE.abstainAbove);
  return {
    minLabels: Number.isInteger(min) && min > 0 ? min : DEFAULT_CALIBRATE.minLabels,
    askAbove: Math.min(askAbove, abstainAbove),
    abstainAbove: Math.max(askAbove, abstainAbove),
  };
};

export const AUTONOMY_KEYS: readonly string[] = ["publishedHorizonMinutes", "margin", "maxMinutes", "maxUsd"];

export interface AutonomyConfig {
  readonly publishedHorizonMinutes: number;
  readonly margin: number;
  readonly maxMinutes: number;
  readonly maxUsd: number;
}

export const DEFAULT_AUTONOMY: AutonomyConfig = {
  publishedHorizonMinutes: 60,
  margin: 0.5,
  maxMinutes: 120,
  maxUsd: 5,
};

const positive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
};

export const parseAutonomy = (tree: ConfigTree): AutonomyConfig => {
  const raw = configMap(tree, "autonomy");
  return {
    publishedHorizonMinutes: positive(raw["publishedHorizonMinutes"], DEFAULT_AUTONOMY.publishedHorizonMinutes),
    margin: share(raw["margin"], DEFAULT_AUTONOMY.margin),
    maxMinutes: positive(raw["maxMinutes"], DEFAULT_AUTONOMY.maxMinutes),
    maxUsd: positive(raw["maxUsd"], DEFAULT_AUTONOMY.maxUsd),
  };
};

const SECTIONS: readonly (readonly [string, readonly string[]])[] = [
  ["evolve", EVOLVE_KEYS],
  ["calibrate", CALIBRATE_KEYS],
  ["autonomy", AUTONOMY_KEYS],
];

export const sectionKeyIssues = (tree: ConfigTree): readonly (readonly [string, string, readonly string[]])[] =>
  SECTIONS.flatMap(([section, keys]) =>
    Object.keys(configMap(tree, section))
      .filter((key) => !keys.includes(key))
      .map((key) => [`${section}.${key}`, key, keys] as const),
  );
