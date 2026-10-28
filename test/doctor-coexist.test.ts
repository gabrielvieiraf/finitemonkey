import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { Runtime } from "../src/core/runtime.js";
import { checkCoexistence } from "../src/doctor/coexistence.js";
import { hookInventory, withDebugLog } from "../src/doctor/hook-inventory.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { type Fixture, machine, PLUGIN_INDEX, settings, USER_SETTINGS } from "./doctor-support.js";
import { FakeClaude, type Step } from "./fake-claude.js";
import { memoryFs } from "./memory-fs.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { BUNDLE, BUNDLE_TEXT, cli, cliJson, fakeRuntime, field, found } from "./support.js";

const OTHER_ROOT = "/home/test/.claude/plugins/cache/acme/loop/1.0.0";

const otherPlugin = (enabled: boolean, hooks: object): Record<string, string> => ({
  [PLUGIN_INDEX]: settings({ version: 2, plugins: { "loop@acme": [{ scope: "user", installPath: OTHER_ROOT }] } }),
  [`${OTHER_ROOT}/hooks/hooks.json`]: settings({ hooks }),
  [USER_SETTINGS]: settings({ enabledPlugins: { "loop@acme": enabled } }),
});

const command = (cmd: string) => [{ hooks: [{ type: "command", command: cmd }] }];

const checks = (fixture: Fixture): readonly string[] => checkCoexistence(machine(fixture)).map((item) => item.check);

describe("doctor: other Stop authorities and hook conflicts", () => {
  it("two loop authorities: another plugin also hooks Stop", () => {
    const found = checkCoexistence(
      machine({ files: otherPlugin(true, { Stop: command("${CLAUDE_PLUGIN_ROOT}/loop.sh") }) }),
    );
    assert.deepEqual(
      found.map((item) => [item.check, item.params?.["others"]]),
      [["hooks.authorities", "loop@acme"]],
    );
  });

  it("a hook duplicated between a plugin and settings", () => {
    const fixture = {
      files: otherPlugin(true, { PreToolUse: command("acme-check") }),
      project: { ".claude/settings.local.json": settings({ hooks: { PreToolUse: command("acme-check") } }) },
    };
    assert.deepEqual(checks(fixture), ["hooks.duplicate"]);
  });

  it("a disabled plugin whose hook still fires from settings", () => {
    const fixture = {
      files: otherPlugin(false, { PreToolUse: command("acme-check") }),
      project: {
        ".claude/settings.local.json": settings({ hooks: { PreToolUse: command(`${OTHER_ROOT}/bin/check`) } }),
      },
    };
    assert.deepEqual(checks(fixture), ["hooks.disabled_plugin"]);
  });

  it("a local ANTHROPIC_BASE_URL proxy, from the environment or from settings", () => {
    assert.deepEqual(checks({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" } }), ["hooks.proxy"]);
    assert.deepEqual(
      checks({ files: { [USER_SETTINGS]: settings({ env: { ANTHROPIC_BASE_URL: "http://localhost:4000/v1" } }) } }),
      ["hooks.proxy"],
    );
    assert.deepEqual(checks({ env: { ANTHROPIC_BASE_URL: "https://gateway.example.com" } }), []);
  });

  it("a tool that rewrites output after tools run", () => {
    const fixture = {
      project: { ".claude/settings.local.json": settings({ hooks: { PostToolUse: command("rtk-rewrite") } }) },
    };
    assert.deepEqual(
      checkCoexistence(machine(fixture)).map((item) => [item.check, item.params?.["owners"]]),
      [["hooks.output_rewriter", "rtk-rewrite"]],
    );
  });

  it("an instruction file edited by a memory tool", () => {
    const fixture = {
      project: { "AGENTS.md": "# Rules\n\n<claude-mem-context>\nyesterday we fixed the cart\n</claude-mem-context>\n" },
    };
    assert.deepEqual(
      checkCoexistence(machine(fixture)).map((item) => [item.check, item.params?.["tool"]]),
      [["hooks.memory_tool", "claude-mem"]],
    );
  });

  it("a clean install reports none", () => {
    assert.deepEqual(checks({}), []);
  });
});

describe("doctor --hooks", () => {
  it("lists every hook with source, failure mode and Stop authority, plus timings from the debug log", () => {
    const env = machine({ files: otherPlugin(true, { Stop: command("${CLAUDE_PLUGIN_ROOT}/loop.sh") }) });
    const rows = withDebugLog(
      hookInventory(env),
      "[DEBUG] Hook Stop ${CLAUDE_PLUGIN_ROOT}/loop.sh finished in 412ms, output 96 bytes\n",
    );
    const loop = rows.find((row) => row.source === "plugin:loop@acme");
    assert.deepEqual(
      loop === undefined ? undefined : [loop.event, loop.failMode, loop.blocksStop, loop.latencyMs, loop.outputBytes],
      ["Stop", "fail-open", true, 412, 96],
    );
    const ours = rows.filter((row) => row.ours && row.event === "PreToolUse");
    assert.ok(ours.length > 0);
    assert.ok(ours.every((row) => row.failMode === "fail-closed"));
  });

  it("prints the inventory and keeps it in --json, without touching another plugin's files", async () => {
    const files = otherPlugin(true, { Stop: command("${CLAUDE_PLUGIN_ROOT}/loop.sh") });
    const fs = memoryFs({
      [BUNDLE]: BUNDLE_TEXT,
      ...Object.fromEntries(Object.entries(files).map(([p, t]) => [toAbsolutePath(p), t])),
    });
    const runtime = fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } });
    const before = fs.files();
    const json = await cliJson(["doctor", "--hooks"], { cwd: toAbsolutePath("/home/ana/project"), runtime });
    const inventory = field(json.body, "data", "hookInventory");
    assert.ok(Array.isArray(inventory) && inventory.length > 0);
    const human = await cli(["doctor", "--hooks", "--fix"], { cwd: toAbsolutePath("/home/ana/project"), runtime });
    assert.match(human.stdout, /hooks? from plugins and settings/);
    const after = fs.files();
    for (const path of Object.keys(before).filter((key) => key.includes("/.claude/plugins/")))
      assert.equal(after[path], before[path], path);
  });
});

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

describe("the gate with another Stop authority", () => {
  const runtime: Runtime = { ...nodeRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };
  const approve = {
    type: "command",
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({ decision: 'approve', reason: 'loop done' }))"],
  };

  const project = async (first: boolean): Promise<Repo> => {
    const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
    repos.push(repo);
    const root = toAbsolutePath(realpathSync.native(repo.root));
    assert.equal((await cli(["init", "--yes"], { cwd: root, runtime, env: {}, version: "1.0.0" })).code, 0);
    const current = JSON.parse(repo.read(".claude/settings.json")) as { hooks: Record<string, unknown[]> };
    const stop = current.hooks["Stop"] ?? [];
    current.hooks["Stop"] = first ? [{ hooks: [approve] }, ...stop] : [...stop, { hooks: [approve] }];
    repo.write(".claude/settings.json", JSON.stringify(current, null, 2));
    repo.commit("install");
    const created = createTask(repoRuntime(), fmPaths(root), {
      id: "t1",
      goal: "change a",
      size: "S",
      base: repo.git("rev-parse", "HEAD").trim(),
      paths: [],
      runs: [],
      tests: "node --test",
      git: [],
      manual: [],
      budget: undefined,
    });
    assert.ok(created.ok);
    return repo;
  };

  const failing = (repo: Repo): readonly Step[] => [
    {
      kind: "act",
      run: () => {
        repo.write("test/a.test.js", PASSING_TEST.replace("assert.equal(1 + 1, 2)", "assert.equal(1 + 1, 3)"));
      },
    },
    {
      kind: "event",
      event: "PostToolUse",
      payload: { tool_name: "Write", tool_input: { file_path: "test/a.test.js" }, tool_response: { success: true } },
    },
    { kind: "event", event: "Stop", payload: { last_assistant_message: "Done, tests pass." } },
  ];

  for (const first of [true, false]) {
    it(`blocks when the other authority runs ${first ? "before" : "after"} it`, async () => {
      const repo = await project(first);
      const claude = new FakeClaude({ project: realpathSync.native(repo.root) });
      await claude.play(failing(repo));
      const stops = claude.runs.filter((run) => run.event === "Stop");
      assert.equal(stops.length, 2);
      assert.equal(claude.blocks("Stop"), 1, JSON.stringify(stops));
    });
  }
});
