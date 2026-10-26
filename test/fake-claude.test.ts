import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { Runtime } from "../src/core/runtime.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { FakeClaude, type Step } from "./fake-claude.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { BUNDLE, cli, found, ROOT } from "./support.js";

const PLUGIN_ROOT = join(ROOT, "plugin");
const FAILING_TEST = PASSING_TEST.replace("assert.equal(1 + 1, 2)", "assert.equal(1 + 1, 3)");

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) {
    try {
      repo.cleanup();
    } catch {
      continue;
    }
  }
});

const runtime: Runtime = { ...nodeRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };

const project = async (install: boolean): Promise<Repo> => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  repos.push(repo);
  const root = toAbsolutePath(realpathSync.native(repo.root));
  if (install) {
    const init = await cli(["init", "--yes"], { cwd: root, runtime, env: {}, version: "1.0.0" });
    assert.equal(init.code, 0, init.stdout + init.stderr);
    repo.commit("install");
  }
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

const edit = (path: string): Step => ({
  kind: "event",
  event: "PostToolUse",
  payload: { tool_name: "Write", tool_input: { file_path: path }, tool_response: { success: true } },
});

const blockOnce = (repo: Repo): readonly Step[] => [
  {
    kind: "act",
    run: () => {
      repo.write("test/a.test.js", FAILING_TEST);
    },
  },
  edit("test/a.test.js"),
  { kind: "event", event: "Stop", payload: { last_assistant_message: "Done, tests pass." } },
  {
    kind: "act",
    run: () => {
      repo.write("test/a.test.js", PASSING_TEST);
    },
  },
  edit("test/a.test.js"),
  { kind: "event", event: "Stop", payload: { last_assistant_message: "Fixed the failing test." } },
];

const assertBlockedOnce = (claude: FakeClaude, source: "plugin" | "project"): void => {
  const stops = claude.runs.filter((run) => run.event === "Stop");
  assert.deepEqual(
    stops.map((run) => [run.source, run.blocked]),
    [
      [source, true],
      [source, false],
    ],
    JSON.stringify(stops),
  );
  assert.equal(claude.blocks("Stop"), 1);
};

describe("Stop through a fake claude that runs the configured hooks", () => {
  it("Stop blocks once through the plugin", async () => {
    const repo = await project(false);
    const claude = new FakeClaude({ project: realpathSync.native(repo.root), pluginRoot: PLUGIN_ROOT });
    assert.ok(claude.hooksFor("Stop").every((hook) => hook.source === "plugin"));
    await claude.play(blockOnce(repo));
    assertBlockedOnce(claude, "plugin");
  });

  it("Stop blocks once through project settings", async () => {
    const repo = await project(true);
    const claude = new FakeClaude({ project: realpathSync.native(repo.root) });
    await claude.play(blockOnce(repo));
    assertBlockedOnce(claude, "project");
  });

  it("Stop blocks once through project settings with the plugin disabled", async () => {
    const repo = await project(true);
    repo.write(
      ".claude/settings.local.json",
      JSON.stringify({ enabledPlugins: { "finitemonkey@finitemonkey": false } }),
    );
    const claude = new FakeClaude({ project: realpathSync.native(repo.root), pluginRoot: PLUGIN_ROOT });
    assert.ok(claude.hooksFor("Stop").every((hook) => hook.source === "project"));
    await claude.play(blockOnce(repo));
    assertBlockedOnce(claude, "project");
  });
});

describe("fake claude", () => {
  it("passes the transcript path to hooks and keeps the transcript it wrote", async () => {
    const repo = await project(false);
    const claude = new FakeClaude({ project: realpathSync.native(repo.root), pluginRoot: PLUGIN_ROOT });
    await claude.play([
      { kind: "transcript", entry: { type: "user", message: { role: "user", content: "add a" } } },
      { kind: "event", event: "UserPromptSubmit", payload: { prompt: "add a" } },
    ]);
    assert.match(readFileSync(claude.transcriptPath, "utf8"), /"content":"add a"/);
    assert.ok(
      claude.runs.every((run) => run.exitCode === 0),
      JSON.stringify(claude.runs),
    );
  });

  it("feeds the statusline command its JSON input", async () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    mkdirSync(join(repo.root, ".claude"), { recursive: true });
    writeFileSync(
      join(repo.root, "status.mjs"),
      'process.stdin.on("data", (d) => process.stdout.write(JSON.parse(d).model.display_name));\n',
    );
    writeFileSync(
      join(repo.root, ".claude", "settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: "node status.mjs" } }),
    );
    const claude = new FakeClaude({ project: realpathSync.native(repo.root) });
    assert.equal(await claude.statusline({ model: { display_name: "Opus" } }), "Opus");
  });

  it("SIGINT ends a hook that is still reading its input", async () => {
    const repo = await project(false);
    const claude = new FakeClaude({ project: realpathSync.native(repo.root), pluginRoot: PLUGIN_ROOT });
    const started = Date.now();
    const [run] = await claude.emit("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, 300);
    assert.ok(run !== undefined);
    assert.ok(run.signal === "SIGINT" || run.exitCode !== 0, JSON.stringify(run));
    assert.ok(Date.now() - started < 10_000);
  });
});
