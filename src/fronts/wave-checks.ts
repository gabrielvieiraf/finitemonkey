import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";
import { DEFAULT_SCREENS, loadLookConfig } from "../look/config.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { WAVE_CHECKS_FEATURE } from "../policy/merge-guards.js";
import { fmPaths } from "../task/paths.js";
import type { Front } from "./state.js";

const GATE_TIMEOUT_MS = 900_000;
const LOOK_TIMEOUT_MS = 600_000;

export interface WavePlan {
  readonly contracts: readonly string[];
  readonly routes: readonly string[];
}

const segments = (route: string): readonly string[] =>
  route
    .split(/[/?#]/)
    .filter((part) => part !== "" && !part.startsWith(":") && !part.startsWith("["))
    .map((part) => part.toLowerCase());

export const touchedRoutes = (routes: readonly string[], changed: readonly string[]): readonly string[] => {
  if (changed.length === 0) return [];
  const lower = changed.map((path) => path.toLowerCase());
  const named = routes.filter((route) => segments(route).some((part) => lower.some((path) => path.includes(part))));
  const shared = lower.some((path) => !routes.some((route) => segments(route).some((part) => path.includes(part))));
  return shared ? routes : named;
};

const changedFiles = (runtime: Runtime, dir: AbsolutePath, base: string): readonly string[] => {
  const result = runtime.git(["diff", "--name-only", `${base}..HEAD`], dir);
  return result.ok ? result.stdout.split("\n").filter((line) => line !== "") : [];
};

export const wavePlan = (runtime: Runtime, dir: AbsolutePath, base: string, fronts: readonly Front[]): WavePlan => {
  const config = loadLookConfig(runtime, dir);
  const screens = changedFiles(runtime, dir, base).filter((path) =>
    matchesAny(path, config?.screens ?? DEFAULT_SCREENS),
  );
  return {
    contracts: [...new Set(fronts.flatMap((front) => (front.contract === null ? [] : [front.contract])))],
    routes: config?.port === undefined ? [] : touchedRoutes(config.routes, screens),
  };
};

const failure = (
  runtime: Runtime,
  dir: AbsolutePath,
  args: readonly string[],
  timeoutMs: number,
): string | undefined => {
  const run = runtime.execSelf(args, dir, timeoutMs);
  if (run.exitCode === 0) return undefined;
  return `finitemonkey ${args.join(" ")}: ${run.timedOut ? "timeout" : `exit ${String(run.exitCode ?? -1)}`}`;
};

export const runWavePlan = (runtime: Runtime, dir: AbsolutePath, plan: WavePlan): readonly string[] => [
  ...plan.contracts.flatMap((task) => failure(runtime, dir, ["gate", "--task", task, "--json"], GATE_TIMEOUT_MS) ?? []),
  ...(plan.routes.length === 0
    ? []
    : [
        failure(
          runtime,
          dir,
          ["look", "--json", ...plan.routes.flatMap((route) => ["--route", route])],
          LOOK_TIMEOUT_MS,
        ),
      ].flatMap((item) => item ?? [])),
];

export const waveGateChecks = (
  runtime: Runtime,
  root: AbsolutePath,
  integration: string,
  base: string,
  fronts: readonly Front[],
): string | undefined => {
  const paths = fmPaths(root);
  const mode = featureMode(runtime, paths, WAVE_CHECKS_FEATURE);
  if (mode === "off") return undefined;
  const dir = toAbsolutePath(integration);
  const plan = wavePlan(runtime, dir, base, fronts);
  if (mode === "shadow") {
    recordFeatureShadow(runtime, paths, WAVE_CHECKS_FEATURE, {
      contracts: [...plan.contracts],
      routes: [...plan.routes],
    });
    return undefined;
  }
  const failed = runWavePlan(runtime, dir, plan);
  return failed.length === 0 ? undefined : failed.join("; ");
};
