import { basename, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import type { ShellCommand } from "../shell/types.js";

export const HEAVY_DIR = "heavy";
export const DEFAULT_STALE_MINUTES = 30;
const MINUTE_MS = 60_000;

const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const INSTALLS = new Set(["ci", "install", "i", "add"]);
const SCRIPTS = /^(?:build|test|check|typecheck|e2e)(?::.*)?$/;
const TOOLS: Readonly<Record<string, RegExp>> = {
  cargo: /^(?:build|test|check)$/,
  go: /^(?:build|test)$/,
  pytest: /.*/,
  tsc: /.*/,
  mvn: /.*/,
  gradle: /.*/,
  gradlew: /.*/,
};
const NPX_HEAVY = /^(?:tsc|jest|vitest|next|vite|playwright|webpack)$/;

const words = (args: readonly string[]): readonly string[] => args.filter((arg) => !arg.startsWith("-"));

const runnerHeavy = (program: string, args: readonly string[]): boolean => {
  const [first, second] = words(args);
  if (first === undefined) return program === "yarn";
  if (INSTALLS.has(first) || first === "test" || first === "t") return true;
  if (first === "run" || first === "run-script") return SCRIPTS.test(second ?? "");
  return program !== "npm" && SCRIPTS.test(first);
};

export const isHeavy = (command: Pick<ShellCommand, "program" | "args">): boolean => {
  const program = basename(command.program)
    .replace(/\.(?:cmd|exe)$/i, "")
    .toLowerCase();
  if (RUNNERS.has(program)) return runnerHeavy(program, command.args);
  if (program === "npx") return NPX_HEAVY.test(words(command.args)[0] ?? "");
  const tool = TOOLS[program];
  return tool?.test(words(command.args)[0] ?? "") === true;
};

const count = (raw: unknown): number | undefined => {
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export const isWsl = (env: Env): boolean => (env["WSL_DISTRO_NAME"] ?? "") !== "" || (env["WSL_INTEROP"] ?? "") !== "";

export const heavyLimit = (env: Env, config: ConfigTree): number =>
  count(env["FINITEMONKEY_HEAVY_LIMIT"]) ?? count(configAt(config, "wt", "heavy_limit")) ?? (isWsl(env) ? 1 : 0);

export const staleMs = (config: ConfigTree): number =>
  (count(configAt(config, "wt", "heavy_stale_minutes")) ?? DEFAULT_STALE_MINUTES) * MINUTE_MS;

export interface Holder {
  readonly id: string;
  readonly cwd: string;
  readonly command: string;
  readonly at: string;
}

export const heavyDir = (runtime: Pick<Runtime, "homeDir">): AbsolutePath =>
  toAbsolutePath(join(runtime.homeDir(), ".finitemonkey", HEAVY_DIR));

export const slotPath = (runtime: Pick<Runtime, "homeDir">, slot: number): AbsolutePath =>
  toAbsolutePath(join(heavyDir(runtime), `slot-${String(slot)}.lock`));

const ownerText = (content: string): string => {
  const parsed = parseJsonObject(content);
  const owner = parsed.ok ? parsed.value["owner"] : undefined;
  return typeof owner === "string" ? owner : content;
};

export const holderIn = (content: string): Holder | undefined => {
  const parsed = parseJsonObject(ownerText(content).trim());
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const { id, cwd, command, at } = parsed.value;
  return typeof id === "string" && typeof cwd === "string" && typeof command === "string" && typeof at === "string"
    ? { id, cwd, command, at }
    : undefined;
};

export const readHolder = (runtime: Pick<Runtime, "readText">, path: AbsolutePath): Holder | undefined => {
  const text = runtime.readText(path);
  return text.ok ? holderIn(text.value) : undefined;
};

export type Acquired =
  { readonly kind: "acquired"; readonly slot: number } | { readonly kind: "busy"; readonly holders: readonly Holder[] };

export const acquireSlot = (
  runtime: Pick<Runtime, "lock" | "mkdir" | "readText" | "homeDir">,
  limit: number,
  holder: Holder,
  stale: number,
): Acquired => {
  runtime.mkdir(heavyDir(runtime));
  const owner = JSON.stringify(holder);
  for (let slot = 1; slot <= limit; slot += 1) {
    if (runtime.lock(slotPath(runtime, slot), { staleMs: stale, owner }).ok) return { kind: "acquired", slot };
  }
  const holders = Array.from({ length: limit }, (_, index) => readHolder(runtime, slotPath(runtime, index + 1)));
  return { kind: "busy", holders: holders.filter((item): item is Holder => item !== undefined) };
};

export const releaseSlots = (
  runtime: Pick<Runtime, "listDir" | "readText" | "remove" | "homeDir">,
  id: string,
): number => {
  const names = runtime.listDir(heavyDir(runtime));
  if (!names.ok) return 0;
  const mine = names.value
    .map((name) => toAbsolutePath(join(heavyDir(runtime), name)))
    .filter((path) => readHolder(runtime, path)?.id === id);
  for (const path of mine) runtime.remove(path);
  return mine.length;
};
