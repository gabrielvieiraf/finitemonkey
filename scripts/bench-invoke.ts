import { BENCH_RUN_ENV } from "../src/commands/hook.js";
import { isRecord, type JsonObject } from "../src/core/parsed.js";
import type { Arm } from "./bench-arms.js";
import type { PlannedRun } from "./bench-plan.js";

export const PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";

export interface PinnedPlugin {
  readonly root: string;
  readonly hooks: JsonObject;
}

export interface InvocationInput {
  readonly run: PlannedRun;
  readonly arm: Arm;
  readonly prompt: string;
  readonly workdir: string;
  readonly settingsPath: string;
  readonly configDir: string;
  readonly model: string;
  readonly maxBudgetUsd: number;
  readonly plugin: PinnedPlugin | undefined;
}

export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly settings: JsonObject;
}

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const benchArgs = (args: readonly unknown[], root: string, run: string): readonly unknown[] => {
  const out: unknown[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--via" && args[index + 1] === "plugin") {
      out.push("--bench-run", run);
      index += 1;
    } else out.push(typeof arg === "string" ? arg.replaceAll(PLUGIN_ROOT_TOKEN, root) : arg);
  }
  return out;
};

const benchHandler = (handler: unknown, root: string, run: string): unknown =>
  isRecord(handler) ? { ...handler, args: benchArgs(list(handler["args"]), root, run) } : handler;

const benchGroup = (group: unknown, root: string, run: string): unknown =>
  isRecord(group)
    ? { ...group, hooks: list(group["hooks"]).map((handler) => benchHandler(handler, root, run)) }
    : group;

export const benchHooks = (plugin: PinnedPlugin, run: string): JsonObject => {
  const hooks = plugin.hooks["hooks"];
  if (!isRecord(hooks)) return {};
  return Object.fromEntries(
    Object.entries(hooks).map(([event, groups]) => [
      event,
      list(groups).map((group) => benchGroup(group, plugin.root, run)),
    ]),
  );
};

export const benchSettings = (input: Pick<InvocationInput, "arm" | "plugin" | "run">): JsonObject => {
  const hooks = input.arm.finitemonkey && input.plugin !== undefined ? benchHooks(input.plugin, input.run.id) : {};
  return { autoMemoryEnabled: false, hooks };
};

export const buildInvocation = (input: InvocationInput): Invocation => {
  const plugin = input.arm.finitemonkey && input.plugin !== undefined ? ["--plugin-dir", input.plugin.root] : [];
  const args = [
    "--print",
    input.prompt,
    "--model",
    input.model,
    "--permission-mode",
    "bypassPermissions",
    "--max-budget-usd",
    input.maxBudgetUsd.toFixed(2),
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--settings",
    input.settingsPath,
    ...plugin,
  ];
  const env = {
    CLAUDE_CONFIG_DIR: input.configDir,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ...(input.arm.finitemonkey ? { [BENCH_RUN_ENV]: input.run.id } : {}),
  };
  return { command: "claude", args, cwd: input.workdir, env, settings: benchSettings(input) };
};
