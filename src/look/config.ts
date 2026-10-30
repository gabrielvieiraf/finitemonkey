import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, configMap, parseConfigYaml } from "../git/project-config.js";
import { TARGET_MIN, TARGET_OPTIONS } from "./a11y.js";
import { COLOR_TOLERANCE } from "./ds.js";
import { DEFAULT_RUNS } from "./perf.js";
import { parseStateSpec, type StateSpec } from "./states.js";
import { LOOK_RULES, type LookRule } from "./types.js";
import { DEFAULT_MAX_DIFF_PIXELS, DEFAULT_THRESHOLD } from "./visual.js";

export const LOOK_CONFIG = ".finitemonkey/look.yml";

export const DEFAULT_SCREENS: readonly string[] = [
  "**/*.tsx",
  "**/*.jsx",
  "**/*.vue",
  "**/*.svelte",
  "**/*.astro",
  "**/*.html",
  "**/*.css",
  "**/*.scss",
  "**/*.sass",
  "**/*.less",
];

export interface LookAllow {
  readonly rule: LookRule;
  readonly route: string;
  readonly decision: string;
}

export interface LookConfig {
  readonly port: number | undefined;
  readonly start: string | undefined;
  readonly host: string;
  readonly routes: readonly string[];
  readonly mocks: readonly string[];
  readonly screens: readonly string[];
  readonly allow: readonly LookAllow[];
  readonly timeoutS: number;
  readonly a11yTarget: number;
  readonly dialogs: Readonly<Record<string, readonly string[]>>;
  readonly states: Readonly<Record<string, readonly StateSpec[]>>;
  readonly successColor: string | undefined;
  readonly skeleton: string | undefined;
  readonly ds: DsConfig;
  readonly forms: Readonly<Record<string, readonly string[]>>;
  readonly formsKeepCleared: readonly string[];
  readonly formValues: Readonly<Record<string, string>>;
  readonly flow: FlowConfig;
  readonly visual: { readonly threshold: number; readonly maxDiffPixels: number };
  readonly perf: PerfConfig;
}

export interface PerfConfig {
  readonly runs: number;
  readonly queriesHeader: string | undefined;
  readonly actions: readonly string[];
}

export interface FlowConfig {
  readonly entry: string | undefined;
  readonly terminal: readonly string[];
  readonly destructive: readonly string[];
  readonly drafts: readonly string[];
}

export interface DsConfig {
  readonly tokens: readonly string[];
  readonly exclude: readonly string[];
  readonly excludeFiles: readonly string[];
  readonly tolerance: number;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

const number = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const allowEntries = (tree: ReturnType<typeof parseConfigYaml>): readonly LookAllow[] =>
  LOOK_RULES.flatMap((rule) =>
    configList(tree, "allow", rule).flatMap((entry) => {
      const [route, decision] = entry.trim().split(/\s+/);
      return route === undefined || decision === undefined ? [] : [{ rule, route, decision }];
    }),
  );

const targetOf = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return TARGET_OPTIONS.find((option) => option === parsed) ?? TARGET_MIN;
};

export const routeLists = (entries: readonly string[]): Readonly<Record<string, readonly string[]>> => {
  const out: Record<string, string[]> = {};
  for (const entry of entries) {
    const match = /^(\S+)\s+(.+)$/.exec(entry.trim());
    if (match?.[1] === undefined || match[2] === undefined) continue;
    (out[match[1]] ??= []).push(match[2].trim());
  }
  return out;
};

const statesOf = (tree: ReturnType<typeof parseConfigYaml>): Readonly<Record<string, readonly StateSpec[]>> => {
  const node = configAt(tree, "states");
  if (node === undefined || typeof node === "string" || Array.isArray(node)) return {};
  return Object.fromEntries(
    Object.keys(node).map((route) => [
      route,
      configList(tree, "states", route).flatMap((entry) => parseStateSpec(entry) ?? []),
    ]),
  );
};

const ratioOf = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
};

const wholeOf = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export const parseLookConfig = (source: string): LookConfig => {
  const tree = parseConfigYaml(source);
  const screens = configAt(tree, "screens");
  const top = configMap(tree);
  return {
    port: number(top["port"]),
    start: text(top["start"]),
    host: text(top["host"]) ?? "127.0.0.1",
    routes: configList(tree, "routes").length === 0 ? ["/"] : configList(tree, "routes"),
    mocks: configList(tree, "mocks"),
    screens: screens === undefined ? DEFAULT_SCREENS : configList(tree, "screens"),
    allow: allowEntries(tree),
    timeoutS: number(top["timeout_s"]) ?? 60,
    a11yTarget: targetOf(configAt(tree, "a11y", "target")),
    dialogs: routeLists(configList(tree, "keyboard", "dialogs")),
    states: statesOf(tree),
    successColor: text(configAt(tree, "ui_states", "success_color")),
    skeleton: text(configAt(tree, "ui_states", "skeleton")),
    forms: routeLists(configList(tree, "forms")),
    formsKeepCleared: configList(tree, "forms_keep_cleared"),
    formValues: configMap(tree, "form_values"),
    perf: {
      runs: number(configAt(tree, "perf", "runs")) ?? DEFAULT_RUNS,
      queriesHeader: text(configAt(tree, "perf", "queries_header")),
      actions: configList(tree, "perf", "actions"),
    },
    visual: {
      threshold: ratioOf(configAt(tree, "visual", "threshold")) ?? DEFAULT_THRESHOLD,
      maxDiffPixels: wholeOf(configAt(tree, "visual", "max_diff_pixels")) ?? DEFAULT_MAX_DIFF_PIXELS,
    },
    flow: {
      entry: text(configAt(tree, "flow", "entry")),
      terminal: configList(tree, "flow", "terminal"),
      destructive: configList(tree, "flow", "destructive"),
      drafts: configList(tree, "flow", "drafts"),
    },
    ds: {
      tokens: [...configList(tree, "ds", "tokens"), ...configList(tree, "ds", "css")],
      exclude: configList(tree, "ds", "exclude"),
      excludeFiles: configList(tree, "ds", "exclude_files"),
      tolerance: number(configAt(tree, "ds", "tolerance")) ?? COLOR_TOLERANCE,
    },
  };
};

export const loadLookConfig = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): LookConfig | undefined => {
  const source = runtime.readText(toAbsolutePath(join(root, LOOK_CONFIG)));
  return source.ok ? parseLookConfig(source.value) : undefined;
};

export const withMock = (route: string, mock: string): string =>
  `${route}${route.includes("?") ? "&" : "?"}mock=${encodeURIComponent(mock)}`;

export const lookRoutes = (config: LookConfig): readonly string[] =>
  config.routes.flatMap((route) => [route, ...config.mocks.map((mock) => withMock(route, mock))]);
