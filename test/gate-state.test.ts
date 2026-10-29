import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { Runtime } from "../src/core/runtime.js";
import { readLedger } from "../src/evidence/ledger.js";
import { readGateStatus } from "../src/gate/hooks/status.js";
import { HOLD_FEATURE } from "../src/gate/hooks/stop.js";
import { runGate } from "../src/gate/run.js";
import { COMPLETION_STATES, outcomeState, STATE_CHECK, transition, TRANSITIONS } from "../src/gate/state.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { readState } from "../src/task/state.js";
import { makeRepo, NO_PR, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { field, parseBody, stdinFrom } from "./support.js";

const t = createTranslator("en");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SLOW = "node slow-check.js";

interface Setup {
  readonly runs?: readonly string[];
  readonly manual?: readonly string[];
  readonly hold?: "active" | "shadow";
}

const setup = (options: Setup = {}): Repo => {
  const repo = makeRepo({
    "src/a.js": "export const a = 1;\n",
    "test/a.test.js": PASSING_TEST,
    ...(options.hold === undefined
      ? {}
      : { ".finitemonkey/policy.yml": `guards:\n  ${HOLD_FEATURE}: ${options.hold}\n` }),
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change a",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: options.runs ?? [],
    tests: "node --test",
    git: [],
    manual: options.manual ?? [],
    budget: undefined,
  });
  assert.ok(created.ok);
  repo.write("src/a.js", "export const a = 2;\n");
  return repo;
};

const timingOut = (base: Runtime): Runtime => ({
  ...base,
  exec: (request) =>
    request.command === SLOW
      ? { found: true, exitCode: null, stdout: "", stderr: "", timedOut: true, durationMs: 1 }
      : base.exec(request),
});

const stop = (repo: Repo, runtime: Runtime, active = false): Promise<HookOutcome> =>
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
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });

const stateLines = (repo: Repo) =>
  readLedger(repoRuntime(), fmPaths(repo.root).evidence("t1")).filter((entry) => entry.check === STATE_CHECK);

describe("completion states", () => {
  for (const from of COMPLETION_STATES) {
    for (const to of COMPLETION_STATES) {
      const allowed = TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${allowed ? "allowed" : "rejected"} by the table`, () => {
        assert.equal(transition(from, to, "test").ok, allowed);
      });
    }
  }

  it("a transition without a reason is rejected", () => {
    assert.equal(transition("unverified", "running", " ").ok, false);
  });

  it("nothing reaches verified without a run in between", () => {
    for (const from of COMPLETION_STATES) {
      if (from !== "running") assert.equal(transition(from, "verified", "test").ok, false, from);
    }
  });

  it("the state comes from the checks: failed, needs approval, partial or verified", () => {
    assert.equal(outcomeState([{ id: "a", status: "failed" }]).state, "failed");
    assert.equal(outcomeState([{ id: "a", status: "unverified", reason: "awaiting_person" }]).state, "needs_approval");
    assert.equal(outcomeState([{ id: "a", status: "unverified", reason: "timeout" }]).state, "partial");
    assert.equal(outcomeState([{ id: "a", status: "passed" }]).state, "verified");
  });
});

describe("a task with an unverified check never reaches done", () => {
  const cases: readonly { readonly cause: string; readonly setup: Setup; readonly runtime: () => Runtime }[] = [
    { cause: "timeout", setup: { runs: [SLOW] }, runtime: () => timingOut(repoRuntime({ gh: NO_PR })) },
    { cause: "no gh", setup: {}, runtime: () => repoRuntime() },
    { cause: "manual check", setup: { manual: ["read the docs"] }, runtime: () => repoRuntime({ gh: NO_PR }) },
  ];
  for (const item of cases) {
    it(`${item.cause}: the task stays open and the ledger records the state with a reason`, async () => {
      const repo = setup(item.setup);
      const outcome = await stop(repo, item.runtime());
      assert.equal(outcome.verdict, "allow");
      const state = readState(repoRuntime(), fmPaths(repo.root));
      assert.equal(state.active, "t1");
      assert.deepEqual(state.done, []);
      const last = stateLines(repo).at(-1);
      assert.ok(last?.state === "partial" || last?.state === "needs_approval", String(last?.state));
      assert.match(last.stateReason ?? "", /^unverified:/);
      assert.equal(readGateStatus(repoRuntime(), fmPaths(repo.root))?.state, last.state);
    });
  }

  it("the manual check waits for the person: needs_approval, not partial", async () => {
    const repo = setup({ manual: ["read the docs"] });
    await stop(repo, repoRuntime({ gh: NO_PR }));
    assert.deepEqual(
      stateLines(repo).map((entry) => [entry.from, entry.state]),
      [
        ["unverified", "running"],
        ["running", "needs_approval"],
      ],
    );
  });

  it("an edit after a verified run records invalidated before the next run", () => {
    const repo = setup();
    const gate = () =>
      runGate({
        runtime: repoRuntime({ gh: NO_PR }),
        cwd: repo.root,
        env: {},
        sessionId: undefined,
        taskId: "t1",
        budgetMs: 120_000,
        fast: false,
      });
    assert.equal(gate().kind, "done");
    repo.write("src/a.js", "export const a = 3;\n");
    assert.equal(gate().kind, "done");
    const states = stateLines(repo).map((entry) => entry.state);
    assert.deepEqual(states, ["running", "verified", "invalidated", "running", "verified"]);
  });

  it("when the hold is active, Stop blocks once with what to verify, then lets the next stop through", async () => {
    const repo = setup({ hold: "active" });
    const first = await stop(repo, repoRuntime());
    assert.equal(first.verdict, "block");
    const reason = String(field(parseBody(first.stdout), "reason"));
    assert.match(reason, /not verified yet \(task t1, tree w[0-9a-f]+, state partial\)/);
    assert.match(reason, /to verify: pr: `gh auth login`, then `finitemonkey gate --task t1`/);
    const second = await stop(repo, repoRuntime(), true);
    assert.equal(second.verdict, "allow");
    assert.equal(readState(repoRuntime(), fmPaths(repo.root)).active, "t1");
  });

  it("in shadow the hold only records what it would have done", async () => {
    const repo = setup({ hold: "shadow" });
    assert.equal((await stop(repo, repoRuntime())).verdict, "allow");
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"feature":"gate-hold"/);
  });
});
