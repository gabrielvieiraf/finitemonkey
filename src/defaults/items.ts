import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { CONFIG_FILE, configAt, configMap, parseConfigYaml } from "../git/project-config.js";

export const DEFAULT_ITEMS = [
  "no-attribution",
  "branch-names",
  "prose-blocks",
  "research-first",
  "no-comments",
  "no-time-estimates",
  "conventional-commits",
] as const;

export const COMMIT_STYLES = ["conventional", "free"] as const;

export type DefaultItem = (typeof DEFAULT_ITEMS)[number];
export type CommitStyle = (typeof COMMIT_STYLES)[number];

export const LEGACY_NEUTRAL_OFF: readonly DefaultItem[] = [
  "no-attribution",
  "branch-names",
  "prose-blocks",
  "research-first",
  "no-comments",
];

export interface ProjectDefaults {
  readonly off: readonly DefaultItem[];
  readonly commits: CommitStyle | undefined;
}

export const ALL_ON: ProjectDefaults = { off: [], commits: undefined };

const LEGACY_NEUTRAL = /^preset:\s*neutral\s*$/m;
const OFF = new Set(["off", "false", "no"]);
const ON = new Set(["on", "true", "yes"]);

export const defaultsFromConfig = (text: string): ProjectDefaults => {
  const tree = parseConfigYaml(text);
  const chosen = configMap(tree, "defaults");
  const legacy = LEGACY_NEUTRAL.test(text) ? LEGACY_NEUTRAL_OFF : [];
  const raw = configAt(tree, "conventions", "commits");
  const commits = COMMIT_STYLES.find((style) => style === raw);
  const off = DEFAULT_ITEMS.filter((item) => {
    const value = chosen[item];
    if (value !== undefined && OFF.has(value)) return true;
    if (value !== undefined && ON.has(value)) return false;
    return legacy.includes(item) || (item === "conventional-commits" && commits === "free");
  });
  return { off, commits };
};

export const isOn = (defaults: ProjectDefaults, item: DefaultItem): boolean => !defaults.off.includes(item);

export const projectDefaults = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): ProjectDefaults => {
  const text = runtime.readText(toAbsolutePath(CONFIG_FILE, root));
  return text.ok ? defaultsFromConfig(text.value) : ALL_ON;
};

export const defaultOn = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, item: DefaultItem): boolean =>
  isOn(projectDefaults(runtime, root), item);

export const defaultsYaml = (defaults: ProjectDefaults): readonly string[] => {
  const off = defaults.off.filter((item) => item !== "conventional-commits");
  return [
    ...(off.length === 0 ? [] : ["defaults:", ...off.map((item) => `  ${item}: off`)]),
    ...(defaults.commits === undefined ? [] : ["conventions:", `  commits: ${defaults.commits}`]),
  ];
};

export const withoutLegacyPreset = (text: string): string => {
  if (!/^preset:/m.test(text) || /^defaults:/m.test(text)) return text.replace(/^preset:.*\n?/m, "");
  const lines = defaultsYaml({ off: LEGACY_NEUTRAL.test(text) ? LEGACY_NEUTRAL_OFF : [], commits: undefined });
  return text.replace(/^preset:.*\n?/m, lines.length === 0 ? "" : `${lines.join("\n")}\n`);
};
