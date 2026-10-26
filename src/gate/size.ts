import { matchesAny } from "../core/glob.js";
import { configAt, configList, type ConfigTree } from "../git/project-config.js";
import { SIZES, type TaskSize } from "../task/types.js";

export interface SizeThreshold {
  readonly files: number;
  readonly lines: number;
}

export interface SizeConfig {
  readonly m: SizeThreshold;
  readonly l: SizeThreshold;
  readonly sensitive: readonly string[];
}

export interface DiffShape {
  readonly files: readonly string[];
  readonly lines: number;
}

export interface SizeVerdict {
  readonly declared: TaskSize;
  readonly computed: TaskSize;
  readonly effective: TaskSize;
  readonly files: number;
  readonly lines: number;
  readonly sensitive: readonly string[];
}

export const DEFAULT_SENSITIVE: readonly string[] = [
  "**/*payment*",
  "**/*payment*/**",
  "**/*billing*",
  "**/*billing*/**",
  "**/*checkout*/**",
  "**/auth/**",
  "**/*auth.*",
  "**/oauth*",
  "**/migrations/**",
  "**/migration/**",
  "**/*.sql",
  "**/openapi*.*",
  "**/swagger*.*",
  "**/*.proto",
  "**/*.graphql",
  "**/*stripe*",
  "**/*openai*",
  "**/*anthropic*",
];

export const DEFAULT_SIZE_CONFIG: SizeConfig = {
  m: { files: 5, lines: 150 },
  l: { files: 20, lines: 600 },
  sensitive: DEFAULT_SENSITIVE,
};

const count = (tree: ConfigTree, fallback: number, ...path: readonly string[]): number => {
  const value = configAt(tree, ...path);
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const threshold = (tree: ConfigTree, key: "m" | "l", fallback: SizeThreshold): SizeThreshold => ({
  files: count(tree, fallback.files, "size", key, "files"),
  lines: count(tree, fallback.lines, "size", key, "lines"),
});

export const sizeConfig = (tree: ConfigTree): SizeConfig => {
  const declared = configAt(tree, "size", "sensitive");
  return {
    m: threshold(tree, "m", DEFAULT_SIZE_CONFIG.m),
    l: threshold(tree, "l", DEFAULT_SIZE_CONFIG.l),
    sensitive: declared === undefined ? DEFAULT_SENSITIVE : configList(tree, "size", "sensitive"),
  };
};

const reaches = (shape: DiffShape, limit: SizeThreshold): boolean =>
  shape.files.length >= limit.files || shape.lines >= limit.lines;

const rank = (size: TaskSize): number => SIZES.indexOf(size);

const larger = (a: TaskSize, b: TaskSize): TaskSize => (rank(a) >= rank(b) ? a : b);

export const computeSize = (shape: DiffShape, config: SizeConfig): Omit<SizeVerdict, "declared" | "effective"> => {
  const sensitive = shape.files.filter((file) => matchesAny(file, config.sensitive));
  const byVolume: TaskSize = reaches(shape, config.l) ? "L" : reaches(shape, config.m) ? "M" : "S";
  const computed = sensitive.length > 0 ? larger(byVolume, "M") : byVolume;
  return { computed, files: shape.files.length, lines: shape.lines, sensitive };
};

export const sizeVerdict = (declared: TaskSize, shape: DiffShape, config: SizeConfig): SizeVerdict => {
  const result = computeSize(shape, config);
  return { ...result, declared, effective: larger(declared, result.computed) };
};

export const upgraded = (verdict: SizeVerdict): boolean => rank(verdict.effective) > rank(verdict.declared);
