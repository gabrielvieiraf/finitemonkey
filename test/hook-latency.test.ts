import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { Runtime } from "../src/core/runtime.js";
import { hookHandler, type HookHandlerJson, INSTALLED_HOOKS, type Runner } from "../src/install/hook-entries.js";
import { SETTINGS_FILE, VENDOR_BIN } from "../src/install/layout.js";
import { pluginHooks } from "../src/install/plugin-hooks.js";
import { BUNDLE, cliJson, field, found, parseBody, ROOT } from "./support.js";

const RUNS = 10;
const P95_LIMIT_MS = Number(process.env["FM_HOOK_P95_MS"] ?? (process.platform === "win32" ? "450" : "300"));

const base = mkdtempSync(join(tmpdir(), "fm-latency-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const common = (event: string, cwd: string): Readonly<Record<string, unknown>> => ({
  session_id: "4f7c2a8e-latency",
  transcript_path: join(cwd, ".claude", "transcript.jsonl"),
  cwd,
  hook_event_name: event,
});

const PAYLOADS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  SessionStart: { source: "startup", model: "claude-opus-5-5" },
  UserPromptSubmit: { prompt: "Add Pix checkout and show the confirmation screen" },
  PreToolUse: { tool_name: "Bash", tool_input: { command: "npm test -- checkout", description: "Run tests" } },
  PostToolUse: {
    tool_name: "Edit",
    tool_input: { file_path: "src/page/checkout.tsx", old_string: "a", new_string: "b" },
    tool_response: { success: true },
  },
  Stop: { stop_hook_active: false, last_assistant_message: "Done: checkout works and tests pass." },
  SubagentStart: { agent_id: "a1", agent_type: "general-purpose" },
  SubagentStop: { agent_id: "a1", agent_type: "general-purpose", stop_hook_active: false },
  PreCompact: { trigger: "auto", custom_instructions: "" },
  ConfigChange: { source: "project_settings", file_path: ".claude/settings.json" },
};

const p95 = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
};

const median = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
};

const time = (bin: string, event: string, cwd: string): number => {
  const input = JSON.stringify({ ...common(event, cwd), ...PAYLOADS[event] });
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [bin, "hook", event], { cwd, input, encoding: "utf8" });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(result.status === 0 || result.status === 2, `${event}: ${result.stderr}`);
  return ms;
};

const runtime: Runtime = { ...nodeRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };

describe("hook latency through the vendored CLI", () => {
  it(`every event answers with p95 under ${String(P95_LIMIT_MS)} ms`, async (t) => {
    const root = toAbsolutePath(join(base, "Área de Trabalho", "meu projeto"));
    mkdirSync(join(root, ".git"), { recursive: true });
    assert.equal((await cliJson(["init", "--yes"], { cwd: root, runtime, env: {}, version: "1.0.0" })).code, 0);
    const bin = join(root, VENDOR_BIN);
    const report: string[] = [];
    const all: number[] = [];
    for (const { event } of INSTALLED_HOOKS) {
      time(bin, event, root);
      const samples = Array.from({ length: RUNS }, () => time(bin, event, root));
      all.push(...samples);
      report.push(`${event} p95 ${p95(samples).toFixed(0)} ms, median ${median(samples).toFixed(0)} ms`);
      assert.ok(median(samples) < P95_LIMIT_MS, `${event} median ${median(samples).toFixed(1)} ms`);
    }
    t.diagnostic(`all hooks p95 ${p95(all).toFixed(0)} ms over ${String(all.length)} runs; ${report.join("; ")}`);
    assert.ok(p95(all) < P95_LIMIT_MS, `p95 ${p95(all).toFixed(1)} ms`);
  });

  it("the vendored CLI reports the version that installed it", async () => {
    const root = toAbsolutePath(join(base, "versão"));
    mkdirSync(join(root, ".git"), { recursive: true });
    await cliJson(["init", "--yes"], { cwd: root, runtime, env: {}, version: "7.8.9" });
    const result = spawnSync(process.execPath, [join(root, VENDOR_BIN), "--version"], { encoding: "utf8" });
    assert.equal(result.stdout.trim(), "7.8.9");
  });

  it("the plugin's bundled CLI reports the plugin version", () => {
    const result = spawnSync(process.execPath, [join(ROOT, "plugin", "scripts", "finitemonkey.mjs"), "--version"], {
      encoding: "utf8",
    });
    const manifest = parseBody(readFileSync(join(ROOT, "plugin", ".claude-plugin", "plugin.json"), "utf8"));
    assert.equal(result.stdout.trim(), field(manifest, "version"));
  });
});

const commandsOf = (hooks: unknown): readonly string[] => {
  const events = field(hooks, "hooks");
  const groups = events !== null && typeof events === "object" ? Object.values(events) : [];
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
  return groups
    .flatMap((value: unknown) => list(value))
    .flatMap((group: unknown) => list(field(group, "hooks")))
    .map((handler: unknown) => JSON.stringify(handler));
};

describe("no hook ever goes to the network", () => {
  const runners: readonly Runner[] = [
    { kind: "local" },
    { kind: "vendored" },
    { kind: "path", path: "/opt/x y/fm.mjs" },
  ];
  for (const runner of runners) {
    it(`project hooks with the ${runner.kind} runner never call npx`, () => {
      const handlers: readonly HookHandlerJson[] = INSTALLED_HOOKS.map((spec) => hookHandler(runner, spec, true));
      for (const handler of handlers) {
        assert.doesNotMatch(JSON.stringify(handler), /npx|npm |@latest/);
        assert.equal(field(handler, "command") === "node" || runner.kind === "path", true);
        assert.ok(Array.isArray(field(handler, "args")), "exec form");
      }
    });
  }

  it("plugin hooks never call npx", () => {
    for (const command of commandsOf(pluginHooks())) assert.doesNotMatch(command, /npx|npm |@latest/);
  });

  it("the settings init writes never call npx", async () => {
    const root = toAbsolutePath(join(base, "sem rede"));
    mkdirSync(join(root, ".git"), { recursive: true });
    await cliJson(["init", "--yes"], { cwd: root, runtime, env: {} });
    const commands = commandsOf(parseBody(readFileSync(join(root, SETTINGS_FILE), "utf8")));
    assert.equal(commands.length, INSTALLED_HOOKS.length);
    for (const command of commands) assert.doesNotMatch(command, /npx|npm |@latest/);
    const handler = parseBody(commands[0] ?? "{}");
    const args = field(handler, "args");
    const argv = (Array.isArray(args) ? args : []).map((arg) => String(arg).replace("${CLAUDE_PROJECT_DIR}", root));
    const input = JSON.stringify({ ...common("SessionStart", root), source: "startup" });
    const ran = spawnSync(process.execPath, argv, { cwd: root, input, encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /"continue":true/);
  });
});
