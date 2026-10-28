import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { Runtime } from "../src/core/runtime.js";
import { comesFromPerson } from "../src/guards/release/markers.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { GATE_HOLD_MS, holdActive, readHold, writeHold } from "../src/supervisor/hold.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { FakeClaude, type Step } from "./fake-claude.js";
import { memoryFs } from "./memory-fs.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { BUNDLE, BUNDLE_TEXT, cli, cliJson, fakeRuntime, field, found, stdinFrom } from "./support.js";

const repos: Repo[] = [];
const dirs: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const SESSION = "fake-session";
const FAILING_TEST = PASSING_TEST.replace("assert.equal(1 + 1, 2)", "assert.equal(1 + 1, 3)");
const runtime: Runtime = { ...nodeRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };

const project = async (optIn: boolean): Promise<Repo> => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  repos.push(repo);
  const root = toAbsolutePath(realpathSync.native(repo.root));
  assert.equal((await cli(["init", "--yes"], { cwd: root, runtime, env: {}, version: "1.0.0" })).code, 0);
  if (optIn)
    repo.write(".finitemonkey/config.yml", `${repo.read(".finitemonkey/config.yml")}supervisor:\n  enabled: true\n`);
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

const holdDirectory = (): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-hold-")));
  dirs.push(dir);
  return dir;
};

const edit: Step = {
  kind: "event",
  event: "PostToolUse",
  payload: { tool_name: "Write", tool_input: { file_path: "test/a.test.js" }, tool_response: { success: true } },
};

const holdText = (dir: string): string | undefined => {
  try {
    return readFileSync(join(dir, `${SESSION}.hold.json`), "utf8");
  } catch {
    return undefined;
  }
};

describe("account-switching supervisor", () => {
  it("a Stop that blocks once holds the switch, a switch in the middle resumes the gate, and the pass releases it", async () => {
    const repo = await project(true);
    const dir = holdDirectory();
    const claude = new FakeClaude({ project: realpathSync.native(repo.root), env: { FINITEMONKEY_HOLD_DIR: dir } });
    await claude.play([
      {
        kind: "act",
        run: () => {
          repo.write("test/a.test.js", FAILING_TEST);
        },
      },
      edit,
      { kind: "event", event: "Stop", payload: { last_assistant_message: "Done, tests pass." } },
    ]);
    assert.equal(claude.blocks("Stop"), 1);
    const held = readHold(nodeRuntime(), toAbsolutePath(dir), SESSION);
    assert.equal(held?.reason, "block");
    assert.ok(holdActive(held, new Date().toISOString()), "the supervisor must wait while the hold is valid");

    const resumed = await runHook("SessionStart", {
      stdin: stdinFrom(
        JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: SESSION,
          cwd: realpathSync.native(repo.root),
          source: "resume",
        }),
      ),
      deadlineMs: 20_000,
      handlers: DEFAULT_HANDLERS,
      cwd: toAbsolutePath(realpathSync.native(repo.root)),
      t: createTranslator("en"),
      startTimer: runtime.startTimer,
      runtime: { ...repoRuntime(), spawnSelf: () => true },
      env: { FINITEMONKEY_HOLD_DIR: dir },
    });
    assert.match(resumed.stdout, /resumed after an account switch while the gate was holding the stop/);

    await claude.play([
      {
        kind: "act",
        run: () => {
          repo.write("test/a.test.js", PASSING_TEST);
        },
      },
      edit,
      { kind: "event", event: "Stop", payload: { last_assistant_message: "Fixed the failing test." } },
    ]);
    assert.equal(claude.blocks("Stop"), 1);
    assert.equal(holdText(dir), undefined);
  });

  it("detection is opt-in: without supervisor.enabled no hold file is written", async () => {
    const repo = await project(false);
    const dir = holdDirectory();
    const claude = new FakeClaude({ project: realpathSync.native(repo.root), env: { FINITEMONKEY_HOLD_DIR: dir } });
    await claude.play([
      {
        kind: "act",
        run: () => {
          repo.write("test/a.test.js", FAILING_TEST);
        },
      },
      edit,
      { kind: "event", event: "Stop", payload: { last_assistant_message: "Done." } },
    ]);
    assert.equal(claude.blocks("Stop"), 1);
    assert.equal(holdText(dir), undefined);
  });

  it("the hold file expires on its own", () => {
    const fs = memoryFs({}, [], "2026-10-27T12:00:00.000Z");
    const dir = toAbsolutePath("/tmp/holds");
    assert.ok(writeHold(fs, dir, { sessionId: "s1", project: "/p", reason: "gate", detail: "" }, GATE_HOLD_MS));
    const hold = readHold(fs, dir, "s1");
    assert.ok(holdActive(hold, "2026-10-27T12:05:00.000Z"));
    assert.ok(!holdActive(hold, "2026-10-27T12:10:00.001Z"));
  });

  it("resume messages from the supervisor are not the person's prompts", () => {
    assert.equal(comesFromPerson("[supervisor] Continue where you left off."), false);
    assert.equal(comesFromPerson("[account-switch] fm: allow tests flaky"), false);
    assert.equal(comesFromPerson("fm: allow tests flaky suite"), true);
  });

  it("usage published by the supervisor feeds the gain report", async () => {
    const root = toAbsolutePath("/home/ana/project");
    const fs = memoryFs({
      [BUNDLE]: BUNDLE_TEXT,
      [toAbsolutePath(".finitemonkey/config.yml", root)]: "schemaVersion: 1\nsupervisor:\n  enabled: true\n",
      [toAbsolutePath("/tmp/holds/usage.json")]: JSON.stringify({ tokens: 1200, costUsd: 0.42, account: "b" }),
    });
    const result = await cliJson(["gain"], {
      cwd: root,
      runtime: fakeRuntime({ fs }),
      env: { FINITEMONKEY_HOLD_DIR: "/tmp/holds" },
    });
    assert.deepEqual(field(result.body, "data", "supervisorUsage"), { tokens: 1200, costUsd: 0.42 });
  });
});
