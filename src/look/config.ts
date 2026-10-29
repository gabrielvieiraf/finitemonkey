import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, configMap, parseConfigYaml } from "../git/project-config.js";
import { TARGET_MIN, TARGET_OPTIONS } from "./a11y.js";
import { parseStateSpec, type StateSpec } from "./states.js";
import { LOOK_RULES, type LookRule } from "./types.js";

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
