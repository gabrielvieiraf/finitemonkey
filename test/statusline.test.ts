import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { parseJsonObject } from "../src/core/parsed.js";
import type { Runtime } from "../src/core/runtime.js";
import { logEvent } from "../src/evidence/log.js";
import { writeGateStatus } from "../src/gate/hooks/status.js";
import { HOOK_FAILURE_EVENT } from "../src/hooks/failure-log.js";
import { SETTINGS_FILE } from "../src/install/layout.js";
import { CEILING_MS } from "../src/statusline/run.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, writeState } from "../src/task/state.js";
import { FakeClaude } from "./fake-claude.js";
import { BUNDLE, cli, cliJson, found, stdinFrom } from "./support.js";

const base = mkdtempSync(join(tmpdir(), "fm-status-"));
after(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
});

let clock = Date.parse("2026-10-26T12:00:00.000Z");
const tick = (): string => {
  clock += 1000;
  return new Date(clock).toISOString();
};

const runtime: Runtime = {
  ...nodeRuntime(),
  probe: () => found("2.1.300 (Claude Code)"),
  selfPath: BUNDLE,
  now: tick,
};

let counter = 0;
const fresh = (files: Readonly<Record<string, string>> = {}): AbsolutePath => {
  counter += 1;
  const root = join(base, `p${String(counter)}`);
  mkdirSync(join(root, ".git"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return toAbsolutePath(root);
};

const USER_LINE = {
  type: "command",
  command: "node -e \"process.stdout.write(String(1 + 1) + ' my-line')\"",
  padding: 2,
};

const settingsWith = (statusLine: unknown): string => `${JSON.stringify({ model: "x", statusLine }, null, 2)}\n`;

const statusLineOf = (root: string): unknown => {
  const parsed = parseJsonObject(readFileSync(join(root, SETTINGS_FILE), "utf8"));
  return parsed.ok ? parsed.value["statusLine"] : undefined;
};

const render = async (root: AbsolutePath, input: unknown = {}, env: Readonly<Record<string, string>> = {}) => {
  const started = Date.now();
  const run = await cli(["statusline"], { cwd: root, runtime, env, stdin: stdinFrom(JSON.stringify(input)) });
  return { ...run, ms: Date.now() - started };
};

describe("statusline", () => {
  it("wraps an existing statusline and keeps it, followed by the Finite Monkey segment", async () => {
    const root = fresh({ [SETTINGS_FILE]: settingsWith(USER_LINE) });
    assert.equal((await cliJson(["init", "--yes"], { cwd: root, runtime, env: {} })).code, 0);
    const claude = new FakeClaude({ project: root });
    const line = await claude.statusline({ workspace: { project_dir: root } });
    assert.match(line, /^2 my-line \| fm/);
  });

  it("wraps a statusline from the user settings when the project has none", async () => {
    const home = join(base, `home${String(counter)}`);
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), settingsWith(USER_LINE));
    const root = fresh();
    assert.equal((await cliJson(["init", "--yes"], { cwd: root, runtime, env: { HOME: home } })).code, 0);
    const out = await render(root, { workspace: { project_dir: root } });
    assert.match(out.stdout, /^2 my-line \| fm/);
  });

  it("uninstall restores the previous statusline exactly", async () => {
    const original = settingsWith(USER_LINE);
    const root = fresh({ [SETTINGS_FILE]: original });
    await cliJson(["init", "--yes"], { cwd: root, runtime, env: {} });
    assert.notDeepEqual(statusLineOf(root), USER_LINE);
    writeFileSync(join(root, SETTINGS_FILE), readFileSync(join(root, SETTINGS_FILE), "utf8").replace('"x"', '"y"'));
    assert.equal((await cliJson(["uninstall", "--yes"], { cwd: root, runtime, env: {} })).code, 0);
    assert.deepEqual(statusLineOf(root), USER_LINE);
  });

  it("uninstall removes the statusline it added when there was none", async () => {
    const root = fresh({ [SETTINGS_FILE]: settingsWith(undefined) });
    await cliJson(["init", "--yes"], { cwd: root, runtime, env: {} });
    writeFileSync(join(root, SETTINGS_FILE), readFileSync(join(root, SETTINGS_FILE), "utf8").replace('"x"', '"y"'));
    await cliJson(["uninstall", "--yes"], { cwd: root, runtime, env: {} });
    assert.equal(statusLineOf(root), undefined);
  });

  it("shows the active task, the gate state and the context use", async () => {
    const root = fresh();
    const paths = fmPaths(root);
    writeState(runtime, paths, { ...readState(runtime, paths), active: "checkout" });
    writeGateStatus(runtime, paths, { status: "failed", task: "checkout", detail: "" });
    const out = await render(root, { workspace: { project_dir: root }, context_window: { used_percentage: 41.6 } });
    assert.equal(out.code, 0);
    assert.equal(out.stdout.trim(), "fm · checkout · gate red · ctx 42%");
  });

  it("a gate failure in the log shows 'gate did not run' until the next green run", async () => {
    const root = fresh();
    const paths = fmPaths(root);
    writeGateStatus(runtime, paths, { status: "passed", task: "t1", detail: "" });
    assert.match((await render(root, { cwd: root })).stdout, /gate green/);
    logEvent(runtime, paths, HOOK_FAILURE_EVENT, { hook: "Stop", verdict: "failed_open", detail: "boom" });
    assert.match((await render(root, { cwd: root })).stdout, /gate did not run/);
    writeGateStatus(runtime, paths, { status: "failed", task: "t1", detail: "" });
    assert.match((await render(root, { cwd: root })).stdout, /gate did not run/);
    writeGateStatus(runtime, paths, { status: "passed", task: "t1", detail: "" });
    assert.match((await render(root, { cwd: root })).stdout, /gate green/);
  });

  it("stays under the time ceiling when the wrapped statusline hangs, using the last output of the session", async () => {
    const root = fresh({
      "wrapped.js": [
        'const fs = require("node:fs");',
        'if (fs.existsSync("slow")) setTimeout(() => {}, 4000);',
        'else process.stdout.write("cached line");',
        "",
      ].join("\n"),
      [SETTINGS_FILE]: settingsWith({ type: "command", command: "node wrapped.js" }),
    });
    await cliJson(["init", "--yes"], { cwd: root, runtime, env: {} });
    const input = { session_id: "s-1", workspace: { project_dir: root } };
    assert.match((await render(root, input)).stdout, /^cached line \| fm/);
    writeFileSync(join(root, "slow"), "");
    const slow = await render(root, input);
    assert.ok(slow.ms < CEILING_MS, `took ${String(slow.ms)} ms`);
    assert.match(slow.stdout, /^cached line \| fm/);
    const other = await render(root, { ...input, session_id: "s-2" });
    assert.ok(other.ms < CEILING_MS);
    assert.match(other.stdout, /^fm/);
  });

  it("respects COLUMNS", async () => {
    const root = fresh();
    writeState(runtime, fmPaths(root), { ...readState(runtime, fmPaths(root)), active: "a-very-long-task-name" });
    const out = await render(root, { cwd: root }, { COLUMNS: "12" });
    assert.equal(out.stdout.trim(), "fm · a-very…");
  });

  it("always exits 0, even outside a repository or with broken input", async () => {
    const outside = toAbsolutePath(mkdtempSync(join(base, "plain-")));
    const run = await cli(["statusline"], { cwd: outside, runtime, env: {}, stdin: stdinFrom("{not json") });
    assert.equal(run.code, 0);
    assert.equal(run.stdout.trim(), "fm");
    assert.ok(!existsSync(join(outside, ".finitemonkey")));
  });
});
