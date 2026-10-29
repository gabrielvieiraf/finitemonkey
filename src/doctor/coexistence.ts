import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { externalBlockers } from "../git/destructive.js";
import { hashText } from "../install/hash.js";
import { asRecord } from "../install/json-text.js";
import { LOCK_FILE } from "../install/layout.js";
import { parseLock } from "../install/lock-file.js";
import { hookInventory, type HookRow, installedPlugins } from "./hook-inventory.js";
import { readSettings } from "./settings.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

const list = (items: Iterable<string>): string => [...new Set(items)].sort().join(", ");

const authorities = (rows: readonly HookRow[]): readonly CheckFinding[] => {
  const owners = new Set(rows.filter((row) => row.enabled && row.event === "Stop").map((row) => row.owner));
  if (owners.size < 2) return [];
  const others = [...owners].filter((owner) => owner !== "finitemonkey");
  return [
    finding(
      "hooks.authorities",
      "warn",
      "doctor.coexist.authorities",
      { others: list(others) },
      "doctor.coexist.fix_authorities",
    ),
  ];
};

const duplicates = (rows: readonly HookRow[]): readonly CheckFinding[] => {
  const enabled = rows.filter((row) => row.enabled);
  const twice = enabled.filter(
    (row) =>
      row.source.startsWith("plugin:") &&
      enabled.some(
        (other) => !other.source.startsWith("plugin:") && other.event === row.event && other.command === row.command,
      ),
  );
  return twice.length === 0
    ? []
    : [
        finding(
          "hooks.duplicate",
          "warn",
          "doctor.coexist.duplicate",
          { hooks: list(twice.map((row) => `${row.event} ${row.owner}`)) },
          "doctor.coexist.fix_duplicate",
        ),
      ];
};

const disabledFiring = (env: DoctorEnv, rows: readonly HookRow[]): readonly CheckFinding[] => {
  const disabled = installedPlugins(env).filter((plugin) => !plugin.enabled);
  const firing = disabled.filter((plugin) =>
    rows.some((row) => !row.source.startsWith("plugin:") && row.command.includes(plugin.root)),
  );
  return firing.map((plugin) =>
    finding(
      "hooks.disabled_plugin",
      "warn",
      "doctor.coexist.disabled_plugin",
      { plugin: plugin.id },
      "doctor.coexist.fix_disabled_plugin",
    ),
  );
};

const LOCAL_HOST = /^https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(?::\d+)?/i;

const proxy = (env: DoctorEnv): readonly CheckFinding[] => {
  const fromSettings = readSettings(env).flatMap(({ settings }) => {
    const value = asRecord(settings["env"])["ANTHROPIC_BASE_URL"];
    return typeof value === "string" ? [value] : [];
  });
  const urls = [env.env["ANTHROPIC_BASE_URL"] ?? "", ...fromSettings].filter((url) => LOCAL_HOST.test(url));
  return urls.length === 0
    ? []
    : [finding("hooks.proxy", "warn", "doctor.coexist.proxy", {}, "doctor.coexist.fix_proxy")];
};

const rewriters = (rows: readonly HookRow[]): readonly CheckFinding[] => {
  const foreign = rows.filter((row) => row.enabled && !row.ours && row.event === "PostToolUse");
  return foreign.length === 0
    ? []
    : [
        finding(
          "hooks.output_rewriter",
          "warn",
          "doctor.coexist.output_rewriter",
          { owners: list(foreign.map((row) => row.owner)) },
          "doctor.coexist.fix_output_rewriter",
        ),
      ];
};

const MEMORY_MARKERS: readonly (readonly [RegExp, string])[] = [
  [/<claude-mem-context>|claude-mem/i, "claude-mem"],
  [/<!--\s*mem0/i, "mem0"],
  [/memory-bank\//i, "memory bank"],
  [/<!--\s*cipher/i, "cipher"],
  [/<!--\s*basic-memory/i, "basic memory"],
];

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"] as const;

const lockHashes = (env: DoctorEnv): ReadonlyMap<string, string> => {
  const text = env.runtime.readText(toAbsolutePath(join(env.root, LOCK_FILE)));
  const lock = text.ok ? parseLock(text.value) : undefined;
  return new Map(lock?.ok === true ? lock.value.entries.map((entry) => [entry.path, entry.hash]) : []);
};

const memoryTools = (env: DoctorEnv): readonly CheckFinding[] => {
  const hashes = lockHashes(env);
  return INSTRUCTION_FILES.flatMap((file) => {
    const text = env.runtime.readText(toAbsolutePath(join(env.root, file)));
    if (!text.ok || hashes.get(file) === hashText(text.value)) return [];
    const tool = MEMORY_MARKERS.find(([pattern]) => pattern.test(text.value))?.[1];
    return tool === undefined
      ? []
      : [
          finding(
            "hooks.memory_tool",
            "warn",
            "doctor.coexist.memory_tool",
            { file, tool },
            "doctor.coexist.fix_memory_tool",
          ),
        ];
  });
};

const blockers = (env: DoctorEnv): readonly CheckFinding[] => {
  const found = externalBlockers(env.runtime, env.root, env.runtime.homeDir());
  return found.length === 0
    ? []
    : [finding("hooks.blockers", "ok", "doctor.coexist.blockers", { tools: found.join(", ") })];
};

export const checkCoexistence: Check = (env) => {
  const rows = hookInventory(env);
  return [
    ...authorities(rows),
    ...duplicates(rows),
    ...disabledFiring(env, rows),
    ...proxy(env),
    ...rewriters(rows),
    ...memoryTools(env),
    ...blockers(env),
  ];
};
