import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { fmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { fresh, type TokenSet, walkW3c } from "./tokens.js";

export const DS_CONFIG_CACHE = "ds-config.json";
export const UTILITY_CONFIGS = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
] as const;
const RESOLVE_TIMEOUT_MS = 20_000;
const THEME_KEYS = ["spacing", "borderRadius", "fontSize", "lineHeight", "colors", "fontFamily", "boxShadow"];

export const RESOLVE_SCRIPT = [
  'const path = require("path");',
  'const { createRequire } = require("module");',
  'const { pathToFileURL } = require("url");',
  "(async () => {",
  "  const file = path.resolve(process.argv[1]);",
  "  const load = createRequire(file);",
  "  const loaded = await import(pathToFileURL(file).href);",
  '  const resolver = load("tailwindcss/resolveConfig");',
  "  const theme = (resolver.default ?? resolver)(loaded.default ?? loaded).theme ?? {};",
  `  const keys = ${JSON.stringify(THEME_KEYS)};`,
  "  process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key) => [key, theme[key] ?? {}]))));",
  "})().catch((error) => {",
  "  process.stderr.write(String(error && error.message ? error.message : error));",
  "  process.exit(1);",
  "});",
].join("\n");

type Tree = Record<string, unknown>;

const group = (type: string, values: unknown, read: (value: unknown) => string | undefined): Tree => {
  const out: Tree = { $type: type };
  if (!isRecord(values)) return out;
  for (const [key, value] of Object.entries(values)) {
    if (isRecord(value) && read(value) === undefined) {
      out[key] = group(type, value, read);
      continue;
    }
    const raw = read(value);
    if (raw !== undefined) out[key] = { $value: raw };
  }
  return out;
};

const scalar = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

const first = (value: unknown): string | undefined => scalar(Array.isArray(value) ? value[0] : value);

const tupleLineHeight = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  const extra: unknown = value[1];
  return scalar(isRecord(extra) ? extra["lineHeight"] : extra);
};

const family = (value: unknown): string | undefined =>
  Array.isArray(value) ? scalar(value[0]) : typeof value === "string" ? value : undefined;

export const themeTokens = (theme: Readonly<Record<string, unknown>>, source: string): TokenSet => {
  const into = fresh();
  const tree: Tree = {
    space: group("dimension", theme["spacing"], scalar),
    radius: group("dimension", theme["borderRadius"], scalar),
    "font-size": group("dimension", theme["fontSize"], first),
    "line-height": group("lineHeight", theme["lineHeight"], scalar),
    "font-size-line-height": group("lineHeight", theme["fontSize"], tupleLineHeight),
    color: group("color", theme["colors"], scalar),
    "font-family": group("fontFamily", theme["fontFamily"], family),
    shadow: group("shadow", theme["boxShadow"], scalar),
  };
  walkW3c(tree, "", undefined, into);
  return { ...into, sources: [source] };
};

export const mergeTokens = (left: TokenSet, right: TokenSet): TokenSet => ({
  colors: [...left.colors, ...right.colors],
  lengths: [...left.lengths, ...right.lengths],
  radii: [...left.radii, ...right.radii],
  fontSizes: [...left.fontSizes, ...right.fontSizes],
  lineHeights: [...left.lineHeights, ...right.lineHeights],
  lineRatios: [...left.lineRatios, ...right.lineRatios],
  fonts: [...left.fonts, ...right.fonts],
  shadows: [...left.shadows, ...right.shadows],
  sources: [...left.sources, ...right.sources],
  names: [...left.names, ...right.names],
});

const configFile = (runtime: Pick<Runtime, "stat">, root: AbsolutePath, declared: string | undefined) =>
  declared ?? UTILITY_CONFIGS.find((file) => runtime.stat(toAbsolutePath(join(root, file)))?.kind === "file");

const resolved = (runtime: Runtime, root: AbsolutePath, file: string): Tree | undefined => {
  const run = runtime.exec({
    command: "node",
    args: ["-e", RESOLVE_SCRIPT, file],
    cwd: root,
    timeoutMs: RESOLVE_TIMEOUT_MS,
  });
  const parsed = run.exitCode === 0 ? parseJsonObject(run.stdout) : undefined;
  if (parsed?.ok === true) return parsed.value;
  logEvent(runtime, fmPaths(root), "ds_config_failed", {
    file,
    detail: run.timedOut ? "timeout" : run.found ? run.stderr.slice(0, 200) : "node not found",
  });
  return undefined;
};

export const utilityConfigTokens = (
  runtime: Runtime,
  root: AbsolutePath,
  declared: string | undefined,
): TokenSet | undefined => {
  const file = configFile(runtime, root, declared);
  const text = file === undefined ? undefined : runtime.readText(toAbsolutePath(join(root, file)));
  if (file === undefined || text?.ok !== true) return undefined;
  const hash = sha256Hex(`${RESOLVE_SCRIPT}\u0000${text.value}`).slice(0, 16);
  const cachePath = fmPaths(root).cache(DS_CONFIG_CACHE);
  const cached = readJsonFile(runtime, cachePath);
  const theme =
    cached?.["hash"] === hash && isRecord(cached["theme"]) ? cached["theme"] : resolved(runtime, root, file);
  if (theme === undefined) return undefined;
  if (cached?.["hash"] !== hash) writeJsonFile(runtime, cachePath, { hash, file, theme });
  return themeTokens(theme, file);
};
