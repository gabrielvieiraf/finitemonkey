import { configAt, type ConfigTree } from "../git/project-config.js";
import type { RuleRate } from "./copy-ledger.js";

export const DEFAULT_SHOW_MIN = 10;

export interface ShowSettings {
  readonly threshold: number | undefined;
  readonly minShown: number;
}

const numberAt = (raw: unknown): number | undefined => {
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const showSettings = (tree: ConfigTree, section: "copy" | "critic"): ShowSettings => {
  const threshold = numberAt(configAt(tree, "ui", section, "show_threshold"));
  const minShown = numberAt(configAt(tree, "ui", section, "min_shown"));
  return {
    threshold: threshold !== undefined && threshold > 0 && threshold <= 1 ? threshold : undefined,
    minShown: minShown !== undefined && minShown >= 1 ? Math.round(minShown) : DEFAULT_SHOW_MIN,
  };
};

export const classShown = (rate: RuleRate, settings: ShowSettings): boolean =>
  settings.threshold === undefined ||
  (rate.shown >= settings.minShown && rate.accepted / rate.shown >= settings.threshold);
