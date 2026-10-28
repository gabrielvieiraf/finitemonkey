import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, loadProjectConfig } from "../git/project-config.js";

export const UI_FEATURE = "ui-review";
export const DEFAULT_DRIFT = 0.6;
export const DEFAULT_CATALOGS: readonly string[] = [
  "**/locales/**/*.json",
  "**/locale/**/*.json",
  "**/i18n/**/*.json",
  "**/messages/**/*.json",
  "**/lang/**/*.json",
];

export interface UiConfig {
  readonly bannedCopy: readonly string[];
  readonly catalogs: readonly string[];
  readonly drift: number;
}

const ratio = (raw: unknown): number => {
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : DEFAULT_DRIFT;
};

export const loadUiConfig = (runtime: Runtime, root: AbsolutePath): UiConfig => {
  const tree = loadProjectConfig(runtime, root);
  const catalogs = configList(tree, "ui", "catalogs");
  return {
    bannedCopy: configList(tree, "ui", "banned_copy").filter((phrase) => phrase.trim() !== ""),
    catalogs: catalogs.length === 0 ? DEFAULT_CATALOGS : catalogs,
    drift: ratio(configAt(tree, "ui", "drift_threshold")),
  };
};
