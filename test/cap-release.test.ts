import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { readGateStatus } from "../src/gate/hooks/status.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, NO_PR, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field, stdinFrom } from "./support.js";

const t = createTranslator("en");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const setup = (): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
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

const stop = (repo: Repo, active: boolean, cap = "4"): Promise<HookOutcome> =>
  runHook("Stop", {
    stdin: stdinFrom(
      JSON.stringify({
        session_id: "s1",
        cwd: repo.root,
        hook_event_name: "Stop",
        stop_hook_active: active,
        last_assistant_message: "Done.",
      }),
    ),
    deadlineMs: 120_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t,
    startTimer: repoRuntime().startTimer,
    runtime: repoRuntime(),
    env: { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: cap },
  });

const releaseByCap = async (repo: Repo): Promise<readonly string[]> => {
  const verdicts: string[] = [];
  for (let round = 0; round < 3; round += 1) {
    repo.write("src/a.js", `export const a = ${String(round + 10)}; // TODO\n`);
    verdicts.push((await stop(repo, round > 0)).verdict);
  }
  return verdicts;
};

const refusals = async (repo: Repo): Promise<readonly unknown[]> => {
  repo.write("msg.txt", "feat: change a\n");
  const runs = [
    ["pr", "open", "--dry-run"],
    ["ci", "gate", "--base", "HEAD"],
    ["commit-msg", "msg.txt"],
    ["push", "check"],
  ];
  const codes: unknown[] = [];
  for (const argv of runs) {
    const { body } = await cliJson(argv, { cwd: repo.root, runtime: repoRuntime() });
    codes.push(field(body, "error", "code"));
  }
  return codes;
};

describe("a session released by the Stop cap", () => {
  it("writes released_by_cap with the completion state and the tree", async () => {
    const repo = setup();
    assert.deepEqual(await releaseByCap(repo), ["block", "block", "allow"]);
    const status = readGateStatus(repoRuntime(), fmPaths(repo.root));
    assert.equal(status?.status, "released_by_cap");
    assert.equal(status.task, "t1");
    assert.equal(status.state, "failed");
    assert.match(status.tree ?? "", /^w[0-9a-f]+$/);
  });

  it("pr open, ci gate and the commit guards refuse until a passed gate overwrites it", async () => {
    const repo = setup();
    await releaseByCap(repo);
    assert.deepEqual(
      await refusals(repo),
      Array.from({ length: 4 }, () => "gate_released_by_cap"),
    );
    repo.write("src/a.js", "export const a = 2;\n");
    const gate = await cli(["gate"], { cwd: repo.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.equal(gate.code, 0, gate.stdout);
    assert.equal(readGateStatus(repoRuntime(), fmPaths(repo.root))?.status, "passed");
    const commit = await cliJson(["commit-msg", "msg.txt"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(commit.code, 0, JSON.stringify(commit.body));
  });

  it("a session ended by no progress stays not_done and does not refuse commits", async () => {
    const repo = setup();
    repo.write("test/a.test.js", PASSING_TEST.replace('test("adds"', 'test.skip("adds"'));
    for (let round = 0; round < 4; round += 1) await stop(repo, round > 0, "8");
    assert.equal(readGateStatus(repoRuntime(), fmPaths(repo.root))?.status, "not_done");
    repo.write("msg.txt", "feat: change a\n");
    const commit = await cliJson(["commit-msg", "msg.txt"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(commit.code, 0, JSON.stringify(commit.body));
  });
});

describe("status --json reports the completion state", () => {
  it("gives state and reason for a task with an unverified check", async () => {
    const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
    repos.push(repo);
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    repo.write("src/a.js", "export const a = 2;\n");
    const { code, body } = await cliJson(["status"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(code, 0);
    assert.equal(field(body, "data", "state"), "partial");
    assert.match(String(field(body, "data", "reason")), /^unverified:.*tests\(no_evidence\)/);
    const human = await cli(["status"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(human.stdout, /completion state partial: unverified:/);
  });
});
