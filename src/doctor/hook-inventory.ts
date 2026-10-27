import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, optionalString, parseJsonObject } from "../core/parsed.js";
import { isOwnHandler } from "../install/hook-entries.js";
import { asList, asRecord } from "../install/json-text.js";
import { PLUGIN_ID } from "../install/settings-merge.js";
import { readSettings } from "./settings.js";
import type { DoctorEnv } from "./types.js";

export interface HookRow {
  readonly source: string;
  readonly owner: string;
  readonly event: string;
  readonly matcher: string | null;
  readonly command: string;
  readonly ours: boolean;
  readonly enabled: boolean;
  readonly failMode: "fail-closed" | "fail-open";
  readonly latencyMs: number | null;
  readonly outputBytes: number | null;
  readonly blocksStop: boolean;
}

export interface PluginRecord {
  readonly id: string;
  readonly root: string;
  readonly enabled: boolean;
}

const commandOf = (handler: JsonObject): string => {
  const command =
    optionalString(handler, "command") ?? optionalString(handler, "url") ?? optionalString(handler, "prompt") ?? "?";
  const args = asList(handler["args"]).filter((arg): arg is string => typeof arg === "string");
  return [command, ...args].join(" ").slice(0, 200);
};

const firstWord = (command: string): string => (command.split(/\s+/)[0] ?? command).split(/[\\/]/).pop() ?? command;

const readJson = (env: DoctorEnv, path: string): JsonObject | undefined => {
  const text = env.runtime.readText(toAbsolutePath(path));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true ? parsed.value : undefined;
};

const pluginsDir = (env: DoctorEnv): string =>
  join(env.env["CLAUDE_CONFIG_DIR"] ?? join(env.runtime.homeDir(), ".claude"), "plugins");

export const enabledPlugins = (env: DoctorEnv): ReadonlyMap<string, boolean> => {
  const order = ["user", "project", "local", "managed"] as const;
  const scoped = readSettings(env);
  const map = new Map<string, boolean>();
  for (const scope of order)
    for (const item of scoped.filter((entry) => entry.scope === scope))
      for (const [id, value] of Object.entries(asRecord(item.settings["enabledPlugins"])))
        if (typeof value === "boolean") map.set(id, value);
  return map;
};

export const installedPlugins = (env: DoctorEnv): readonly PluginRecord[] => {
  const index = readJson(env, join(pluginsDir(env), "installed_plugins.json"));
  const enabled = enabledPlugins(env);
  return Object.entries(asRecord(index?.["plugins"])).flatMap(([id, value]) => {
    const records = Array.isArray(value) ? value.filter(isRecord) : isRecord(value) ? [value] : [];
    const record = records.find((item) => item["projectPath"] === env.root) ?? records[0];
    const root = record === undefined ? undefined : optionalString(record, "installPath");
    return root === undefined ? [] : [{ id, root, enabled: enabled.get(id) ?? true }];
  });
};

const rowsOf = (
  source: string,
  owner: (handler: JsonObject) => string,
  hooks: unknown,
  enabled: boolean,
): readonly HookRow[] =>
  Object.entries(asRecord(hooks)).flatMap(([event, groups]) =>
    asList(groups).flatMap((group) => {
      const matcher = optionalString(asRecord(group), "matcher") ?? null;
      return asList(asRecord(group)["hooks"])
        .filter(isRecord)
        .map((handler) => ({
          source,
          owner: owner(handler),
          event,
          matcher,
          command: commandOf(handler),
          ours: owner(handler) === "finitemonkey",
          enabled,
          failMode: handler["onFailure"] === "block" ? ("fail-closed" as const) : ("fail-open" as const),
          latencyMs: null,
          outputBytes: null,
          blocksStop: event === "Stop" || event === "SubagentStop",
        }));
    }),
  );

export const hookInventory = (env: DoctorEnv): readonly HookRow[] => {
  const settings = readSettings(env).flatMap(({ scope, settings: value }) =>
    rowsOf(
      scope,
      (handler) => (isOwnHandler(handler) ? "finitemonkey" : firstWord(commandOf(handler))),
      value["hooks"],
      true,
    ),
  );
  const plugins = installedPlugins(env).flatMap((plugin) => {
    const file = readJson(env, join(plugin.root, "hooks", "hooks.json"));
    const owner = plugin.id === PLUGIN_ID ? "finitemonkey" : plugin.id;
    return rowsOf(`plugin:${plugin.id}`, () => owner, file?.["hooks"], plugin.enabled);
  });
  return [...settings, ...plugins];
};

const LATENCY = /hook[^\n]*?\b(\d+(?:\.\d+)?)\s*ms/i;
const OUTPUT = /hook[^\n]*?output[^\n]*?\b(\d+)\s*(?:bytes|chars)/i;

export const withDebugLog = (rows: readonly HookRow[], log: string | undefined): readonly HookRow[] => {
  if (log === undefined) return rows;
  const lines = log.split("\n");
  return rows.map((row) => {
    const mine = lines.filter(
      (line) => line.includes(row.command.split(" ")[0] ?? row.command) && line.includes(row.event),
    );
    const latencies = mine.flatMap((line) => {
      const match = LATENCY.exec(line);
      return match === null ? [] : [Number(match[1])];
    });
    const outputs = mine.flatMap((line) => {
      const match = OUTPUT.exec(line);
      return match === null ? [] : [Number(match[1])];
    });
    return {
      ...row,
      latencyMs: latencies.length === 0 ? row.latencyMs : Math.max(...latencies),
      outputBytes: outputs.length === 0 ? row.outputBytes : Math.max(...outputs),
    };
  });
};
