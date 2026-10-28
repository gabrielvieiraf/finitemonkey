import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree, loadProjectConfig } from "../git/project-config.js";

export const DEFAULT_DEPLOY_BRANCH = "main";
export const DEFAULT_WAIT_S = 600;
export const DEFAULT_INTERVAL_S = 15;
export const DEFAULT_LIVE_STATUS = 200;

export interface DeployConfig {
  readonly versionUrl?: string;
  readonly field?: string;
  readonly environment?: string;
  readonly branch: string;
  readonly waitS: number;
  readonly intervalS: number;
  readonly status: number;
}

const text = (tree: ConfigTree, key: string): string | undefined => {
  const value = configAt(tree, "deploy", key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

const seconds = (tree: ConfigTree, key: string, fallback: number): number => {
  const parsed = Number.parseInt(text(tree, key) ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const parseDeployConfig = (tree: ConfigTree): DeployConfig | undefined => {
  const versionUrl = text(tree, "version_url");
  const environment = text(tree, "environment");
  if (versionUrl === undefined && environment === undefined) return undefined;
  const field = text(tree, "field");
  return {
    ...(versionUrl === undefined ? {} : { versionUrl }),
    ...(environment === undefined ? {} : { environment }),
    ...(field === undefined ? {} : { field }),
    branch: text(tree, "branch") ?? DEFAULT_DEPLOY_BRANCH,
    waitS: seconds(tree, "wait_s", DEFAULT_WAIT_S),
    intervalS: seconds(tree, "interval_s", DEFAULT_INTERVAL_S),
    status: seconds(tree, "status", DEFAULT_LIVE_STATUS),
  };
};

export const loadDeployConfig = (runtime: Runtime, root: AbsolutePath): DeployConfig | undefined =>
  parseDeployConfig(loadProjectConfig(runtime, root));
