import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { Env } from "../src/core/context.js";
import type { Runtime } from "../src/core/runtime.js";
import { readGateStatus } from "../src/gate/hooks/status.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { catalogs } from "../src/i18n/catalogs.js";
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

interface StopOptions {
  readonly active?: boolean;
  readonly env?: Env;
  readonly runtime?: Runtime;
  readonly event?: "Stop" | "SubagentStop";
}

const stop = (repo: Repo, options: StopOptions = {}): Promise<HookOutcome> => {
  const runtime = options.runtime ?? repoRuntime();
  const event = options.event ?? "Stop";
  return runHook(event, {
    stdin: stdinFrom(
      JSON.stringify({
        session_id: "s1",
        cwd: repo.root,
        hook_event_name: event,
        stop_hook_active: options.active ?? false,
        last_assistant_message: "Done. The coupon works now.",
      }),
    ),
    deadlineMs: 120_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t,
    startTimer: runtime.startTimer,
    runtime,
    env: options.env ?? {},
  });
};

const breakTests = (repo: Repo): void => {
  repo.write("test/a.test.js", PASSING_TEST.replace('test("adds"', 'test.skip("adds"'));
};

describe("Stop gate", () => {
  it("blocks with the list of what is missing, as facts for the model", async () => {
    const repo = setup();
    breakTests(repo);
    const outcome = await stop(repo);
    assert.equal(outcome.verdict, "block");
    const body = parseBody(outcome.stdout);
    assert.equal(field(body, "decision"), "block");
    const reason = String(field(body, "reason"));
    const lines = reason.split("\n");
    assert.match(lines[0] ?? "", /^Finite Monkey gate: not done \(task t1, tree w[0-9a-f]+\)\.$/);
    assert.equal(lines[1], 'claim: "Done. The coupon works now."');
    assert.match(lines[2] ?? "", /^requires: tests tests kept/);
    assert.match(lines[3] ?? "", /^not enough: tests: .*skip, only or todo added in test\/a\.test\.js/);
    assert.doesNotMatch(reason, /allow|finitemonkey:|--/);
    assert.match(String(field(body, "systemMessage")), /Held the "done"\. .*Fix the code, not the witness\./);
  });

  it("keeps blocking while stop_hook_active is set and ends with a visible NOT DONE", async () => {
    const repo = setup();
    breakTests(repo);
    const verdicts: string[] = [];
    for (let round = 0; round < 4; round += 1) verdicts.push((await stop(repo, { active: round > 0 })).verdict);
    assert.deepEqual(verdicts, ["block", "block", "block", "allow"]);
    const last = await stop(repo, { active: true });
    assert.equal(last.verdict, "block");
  });

  it("the final NOT DONE report lists what is missing and is recorded", async () => {
    const repo = setup();
    breakTests(repo);
    let outcome: HookOutcome | undefined;
    for (let round = 0; round < 4; round += 1) outcome = await stop(repo, { active: round > 0 });
    const message = String(field(parseBody(outcome?.stdout ?? "{}"), "systemMessage"));
    assert.match(
      message,
      /NOT DONE after 3 block\(s\).*Missing: tests \(skip, only or todo added in test\/a\.test\.js/,
    );
    assert.equal(readGateStatus(repoRuntime(), fmPaths(repo.root))?.status, "not_done");
  });

  it("stops blocking before Claude Code's own continuation cap", async () => {
    const repo = setup();
    const verdicts: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      repo.write("src/a.js", `export const a = ${String(round + 10)}; // TODO\n`);
      verdicts.push((await stop(repo, { active: round > 0, env: { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "4" } })).verdict);
    }
    assert.deepEqual(verdicts, ["block", "block", "allow"]);
  });

  it("allows a green change with an unverified PR, visibly, without closing the task", async () => {
    const repo = setup();
    repo.write("src/a.js", "export const a = 2;\n");
    const outcome = await stop(repo);
    assert.equal(outcome.verdict, "allow");
    assert.match(String(field(parseBody(outcome.stdout), "systemMessage")), /Not proven yet: pr/);
    assert.equal(readState(repoRuntime(), fmPaths(repo.root)).active, "t1");
  });

  it("passes a fully green change, says so with the brand line and closes the task", async () => {
    const repo = setup();
    repo.write("src/a.js", "export const a = 2;\n");
    const outcome = await stop(repo, { runtime: repoRuntime({ gh: NO_PR }) });
    assert.match(
      String(field(parseBody(outcome.stdout), "systemMessage")),
      /Gate green: .*One monkey, finite time, work finished\./,
    );
    assert.equal(readState(repoRuntime(), fmPaths(repo.root)).active, undefined);
    assert.deepEqual(readState(repoRuntime(), fmPaths(repo.root)).done, ["t1"]);
  });

  it("when the gate cannot run, the person sees GATE DID NOT RUN and the stop is not blocked", async () => {
    const repo = setup();
    repo.write("src/a.js", "export const a = 2;\n");
    const outcome = await stop(repo, { runtime: repoRuntime({ failAppend: true }) });
    assert.equal(outcome.verdict, "allow");
    assert.match(
      String(field(parseBody(outcome.stdout), "systemMessage")),
      /GATE DID NOT RUN: could not write the evidence ledger/,
    );
    assert.equal(readGateStatus(repoRuntime(), fmPaths(repo.root))?.status, "not_run");
  });

  it("a session that did not touch the tree is not gated", async () => {
    const repo = makeRepo({ "a.txt": "x" });
    repos.push(repo);
    assert.deepEqual(parseBody((await stop(repo)).stdout), { continue: true });
  });

  it("SubagentStop only gates a subagent working in its own worktree", async () => {
    const repo = setup();
    breakTests(repo);
    assert.equal((await stop(repo, { event: "SubagentStop" })).verdict, "allow");
  });
});

describe("model-facing text never teaches the way around a guard", () => {
  const HUMAN = /^gate\.(human|release|prs|config\.human|config\.released|guard\.[a-z]+\.human|skipped|baseline)\b/;
  const HINTS = [
    /finitemonkey:/i,
    /\ballow\b/i,
    /--no-verify/,
    /--yes/,
    /\btrust\b/i,
    /[A-Z_]{3,}=/,
    /HUSKY|FINITEMONKEY_|CLAUDE_CODE_/,
    /\bmarker\b/i,
  ];
  const keys = Object.keys(catalogs.en).filter((key) => key.startsWith("gate.") && !HUMAN.test(key));
  for (const lang of ["en", "pt-BR", "es"] as const) {
    it(`${lang}: ${String(keys.length)} gate and guard messages carry no bypass hint`, () => {
      const offenders = keys.filter((key) => {
        const text: string = catalogs[lang][key as keyof (typeof catalogs)["en"]];
        return HINTS.some((pattern) => pattern.test(text));
      });
      assert.deepEqual(offenders, []);
    });
  }
});
