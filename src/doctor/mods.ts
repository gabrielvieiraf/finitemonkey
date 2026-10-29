import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { PLUGIN_ID } from "../install/settings-merge.js";
import { installedPlugins } from "./hook-inventory.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

export const VALIDATE_TIMEOUT_MS = 20_000;

export const MANAGED_SETTINGS: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  linux: "/etc/claude-code/managed-settings.json",
  darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
  win32: "C:\\ProgramData\\ClaudeCode\\managed-settings.json",
};

const hooksOfNote = (note: string): readonly string[] => {
  const match = /^\S+ hooks: (.*)$/.exec(note);
  return match?.[1] === undefined ? [] : match[1].split(/,\s*(?![^{]*\})/).map((item) => item.trim());
};

export const riskyReach = (notes: readonly string[]): readonly string[] =>
  notes
    .flatMap(hooksOfNote)
    .filter(
      (hook) =>
        hook === "tool.call" ||
        hook.startsWith("tool.check") ||
        hook.startsWith("session.append") ||
        (hook.startsWith("ui.render{") && hook.includes("AskUserQuestion")),
    );

const notesOf = (stdout: string): readonly string[] => {
  const parsed = parseJsonObject(stdout);
  if (!parsed.ok) return [];
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
  return list(parsed.value["contents"])
    .filter(isRecord)
    .flatMap((entry) => list(entry["notes"]))
    .filter((note): note is string => typeof note === "string");
};

const hasModule = (env: DoctorEnv, root: string): boolean => {
  const text = env.runtime.readText(toAbsolutePath(join(root, "hooks", "hooks.json")));
  if (!text.ok) return false;
  const parsed = parseJsonObject(text.value);
  return parsed.ok && Array.isArray(parsed.value["modules"]) && parsed.value["modules"].length > 0;
};

const reachOf = (env: DoctorEnv, root: string): readonly string[] => {
  const result = env.runtime.exec({
    command: "claude",
    args: ["plugin", "validate", "--json", root],
    cwd: env.root,
    timeoutMs: VALIDATE_TIMEOUT_MS,
    shell: env.platform === "win32",
  });
  return result.found ? riskyReach(notesOf(result.stdout)) : [];
};

const builtInGuard = (env: DoctorEnv): boolean => {
  const path = MANAGED_SETTINGS[env.platform];
  return path !== undefined && env.runtime.stat(toAbsolutePath(path)) !== undefined;
};

export const checkMods: Check = (env): readonly CheckFinding[] => {
  const risky = installedPlugins(env)
    .filter((plugin) => plugin.id !== PLUGIN_ID && plugin.enabled && hasModule(env, plugin.root))
    .flatMap((plugin) => {
      const reach = reachOf(env, plugin.root);
      return reach.length === 0 ? [] : [{ id: plugin.id, reach }];
    });
  if (risky.length === 0) return [finding("mods", "ok", "doctor.mods.none")];
  const guarded = builtInGuard(env);
  return risky.map((mod) =>
    finding(
      "mods",
      guarded ? "ok" : "warn",
      guarded ? "doctor.mods.guarded" : "doctor.mods.reach",
      { plugin: mod.id, reach: mod.reach.join(", ") },
      guarded ? undefined : "doctor.mods.fix",
    ),
  );
};
