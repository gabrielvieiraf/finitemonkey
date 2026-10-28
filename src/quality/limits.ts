import type { AbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, type ConfigTree, parseConfigYaml } from "../git/project-config.js";
import { policyPath } from "../policy/policy.js";

export interface QualityLimits {
  readonly fileLinesWarn: number;
  readonly fileLinesBlock: number;
  readonly functionLinesWarn: number;
  readonly complexityBlock: number;
  readonly nestingBlock: number;
  readonly paramsWarn: number;
  readonly cloneLines: number;
  readonly chainWarn: number;
  readonly identifiersWarn: number;
  readonly ignore: readonly string[];
}

export const QUALITY_GUARD = "quality";

export const DEFAULT_IGNORE: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/vendor/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/*.min.js",
  "**/*.d.ts",
  "**/*.generated.*",
  "**/fixtures/**",
  "plugin/scripts/**",
];

export const DEFAULT_LIMITS: QualityLimits = {
  fileLinesWarn: 400,
  fileLinesBlock: 800,
  functionLinesWarn: 60,
  complexityBlock: 15,
  nestingBlock: 4,
  paramsWarn: 4,
  cloneLines: 10,
  chainWarn: 5,
  identifiersWarn: 30,
  ignore: DEFAULT_IGNORE,
};

type NumericLimit = Exclude<keyof QualityLimits, "ignore">;

const NUMERIC: readonly NumericLimit[] = [
  "fileLinesWarn",
  "fileLinesBlock",
  "functionLinesWarn",
  "complexityBlock",
  "nestingBlock",
  "paramsWarn",
  "cloneLines",
  "chainWarn",
  "identifiersWarn",
];

const positive = (tree: ConfigTree, key: NumericLimit): number => {
  const value = configAt(tree, QUALITY_GUARD, key);
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIMITS[key];
};

export const parseLimits = (text: string): QualityLimits => {
  const tree = parseConfigYaml(text);
  const numbers = Object.fromEntries(NUMERIC.map((key) => [key, positive(tree, key)]));
  const extra = configList(tree, QUALITY_GUARD, "ignore");
  return { ...DEFAULT_LIMITS, ...numbers, ignore: [...DEFAULT_IGNORE, ...extra] };
};

export const loadLimits = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): QualityLimits => {
  const text = runtime.readText(policyPath(root));
  return text.ok ? parseLimits(text.value) : DEFAULT_LIMITS;
};

const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|cs|php|swift|c|cc|cpp|h|hpp)$/;

export const isQualityFile = (file: string, limits: QualityLimits): boolean =>
  CODE.test(file) && !file.startsWith(".finitemonkey/") && !matchesAny(file, limits.ignore);
