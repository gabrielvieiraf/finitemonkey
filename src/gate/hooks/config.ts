import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { nowMs } from "../../core/clock.js";
import type { Env } from "../../core/context.js";
import { isRecord, parseJsonObject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { activeGrant } from "../../guards/release/grants.js";
import { textField } from "../../hooks/fields.js";
import type { HookHandler } from "../../hooks/handlers.js";
import type { FmPaths } from "../../task/paths.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";
import { allowWith, human, projectPaths } from "./common.js";

export const CONFIG_FILE = "config-hooks.json";
const GUARDED_SOURCES = new Set(["user_settings", "project_settings", "local_settings"]);

export interface HookCensus {
  readonly hooks: number;
  readonly disabled: boolean;
}

const countIn = (value: unknown): number => {
  if (typeof value === "string") return /\bfinitemonkey\b|\bfm hook\b/.test(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum: number, item: unknown) => sum + countIn(item), 0);
  return isRecord(value) ? Object.values(value).reduce((sum: number, item) => sum + countIn(item), 0) : 0;
};

export const censusOf = (text: string | undefined): HookCensus | undefined => {
  if (text === undefined) return { hooks: 0, disabled: false };
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return undefined;
  return { hooks: countIn(parsed.value["hooks"]), disabled: parsed.value["disableAllHooks"] === true };
};

const settingsFiles = (paths: FmPaths, env: Env): readonly AbsolutePath[] => [
  toAbsolutePath(join(paths.root, ".claude", "settings.json")),
  toAbsolutePath(join(paths.root, ".claude", "settings.local.json")),
  ...(env["HOME"] === undefined ? [] : [toAbsolutePath(join(env["HOME"], ".claude", "settings.json"))]),
];

const read = (runtime: Pick<Runtime, "readText">, path: AbsolutePath): string | undefined => {
  const text = runtime.readText(path);
  return text.ok ? text.value : undefined;
};

const known = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Readonly<Record<string, number>> => {
  const raw = readJsonFile(runtime, paths.cache(CONFIG_FILE))?.["hooks"];
  return isRecord(raw)
    ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
    : {};
};

const save = (runtime: Runtime, paths: FmPaths, counts: Readonly<Record<string, number>>): void => {
  writeJsonFile(runtime, paths.cache(CONFIG_FILE), { hooks: { ...counts } });
};

export const recordConfigHooks = (runtime: Runtime, paths: FmPaths, env: Env): void => {
  const counts = Object.fromEntries(
    settingsFiles(paths, env).map((file) => [file, censusOf(read(runtime, file))?.hooks ?? 0]),
  );
  save(runtime, paths, { ...known(runtime, paths), ...counts });
};

export const configChange: HookHandler = (input) => {
  const source = textField(input.payload.raw, "source", "config_source") ?? "";
  const file = textField(input.payload.raw, "file_path", "config_path");
  const paths = projectPaths(input);
  if (!GUARDED_SOURCES.has(source) || file === undefined || paths === undefined) return { kind: "allow" };
  const { runtime, t } = input;
  const path = toAbsolutePath(file, paths.root);
  const census = censusOf(read(runtime, path));
  const before = known(runtime, paths)[path] ?? 0;
  if (census === undefined || (census.hooks >= before && !census.disabled)) {
    if (census !== undefined) save(runtime, paths, { ...known(runtime, paths), [path]: census.hooks });
    return { kind: "allow" };
  }
  const disabled = census.disabled;
  if (activeGrant(runtime, paths, "config", nowMs(runtime), input.payload.sessionId) !== undefined) {
    save(runtime, paths, { ...known(runtime, paths), [path]: census.hooks });
    return allowWith({ systemMessage: human(t("gate.config.released", { file })) });
  }
  const reason = t(disabled ? "gate.config.disabled" : "gate.config.removed", {
    file,
    before,
    after: census.hooks,
  });
  return {
    kind: "block",
    reason,
    output: { decision: "block", reason, systemMessage: human(t("gate.config.human", { file })) },
  };
};
