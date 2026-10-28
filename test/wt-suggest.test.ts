import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { HookEvent } from "../src/hooks/events.js";
import type { HookHandlers } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { WT_SUGGEST_HANDLERS } from "../src/wt/suggest-hooks.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const CACHE = toAbsolutePath(join(PROJECT, ".finitemonkey", "cache", "wt-classes.json"));
const HANDLERS: HookHandlers = withPolicy({ id: "wt-suggest", damage: false, handlers: WT_SUGGEST_HANDLERS });
const MB = 1_048_576;

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const projectFs = (): MemoryFs =>
  memoryFs({
    [toAbsolutePath(join(PROJECT, ".git", "HEAD"))]: "ref: refs/heads/main\n",
    [toAbsolutePath(join(PROJECT, ".finitemonkey", "config.yml"))]: "lang: en\n",
    [toAbsolutePath(join(PROJECT, ".git", "worktrees", "feat", "HEAD"))]: "ref: refs/heads/feat\n",
  });

const cache = (fs: MemoryFs, classes: readonly string[]): void => {
  const worktrees = classes.map((cls, index) => ({ path: `/home/ana/wt/${String(index)}`, cls, bytes: 100 * MB }));
  fs.writeText(CACHE, JSON.stringify({ at: fs.now(), worktrees }));
};

const fire = async (
  fs: MemoryFs,
  event: HookEvent,
  calls: string[],
  spawned: string[][] = [],
): Promise<HookOutcome> => {
  const runtime = fakeRuntime({
    fs,
    spawned,
    git: (args) => {
      calls.push(`git ${args.join(" ")}`);
      return { found: true, ok: false, stdout: "" };
    },
    exec: (request) => {
      calls.push(`${request.command} ${request.args.join(" ")}`);
      return undefined;
    },
  });
  const payload: JsonObject = {
    hook_event_name: event,
    session_id: "s1",
    cwd: PROJECT,
    source: "startup",
    stop_hook_active: false,
  };
  return runHook(event, {
    stdin: stdinFrom(JSON.stringify(payload)),
    deadlineMs: 5000,
    handlers: HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const message = (outcome: HookOutcome): string => {
  const text = field(parseBody(outcome.stdout), "systemMessage");
  return typeof text === "string" ? text : "";
};

describe("wt: merged worktrees line at session start", () => {
  it("reads only the cache: no git call, one line with how many, how much space and the clean command", async () => {
    const fs = projectFs();
    cache(fs, ["contained", "equivalent", "dirty", "recent"]);
    const calls: string[] = [];
    const line = message(await fire(fs, "SessionStart", calls));
    assert.deepEqual(calls, []);
    assert.match(line, /2 merged worktrees use about 200 MB/);
    assert.match(line, /finitemonkey wt clean/);
  });

  it("says nothing without a cache or without cleanable worktrees", async () => {
    assert.equal(message(await fire(projectFs(), "SessionStart", [])), "");
    const fs = projectFs();
    cache(fs, ["dirty", "recent", "unpushed"]);
    assert.equal(message(await fire(fs, "SessionStart", [])), "");
  });

  it("dismissing silences the line until the count grows", async () => {
    const fs = projectFs();
    cache(fs, ["contained", "equivalent"]);
    const runtime = fakeRuntime({ fs });
    assert.equal((await cliJson(["wt", "dismiss"], { cwd: PROJECT, runtime })).code, 0);
    assert.equal(message(await fire(fs, "SessionStart", [])), "");
    cache(fs, ["contained", "equivalent", "contained"]);
    assert.match(message(await fire(fs, "SessionStart", [])), /3 merged worktrees/);
  });

  it("shadow logs the suggestion without showing it", async () => {
    const fs = projectFs();
    fs.writeText(toAbsolutePath(join(PROJECT, ".finitemonkey", "policy.yml")), "guards:\n  wt-suggest: shadow\n");
    cache(fs, ["contained"]);
    assert.equal(message(await fire(fs, "SessionStart", [])), "");
    const log = fs.readText(toAbsolutePath(join(PROJECT, ".finitemonkey", "log.jsonl")));
    assert.ok(log.ok && log.value.includes('"wt.suggested"'));
  });
});

describe("wt: background classification from Stop", () => {
  it("starts at most once a day", async () => {
    const fs = projectFs();
    const spawned: string[][] = [];
    await fire(fs, "Stop", [], spawned);
    await fire(fs, "Stop", [], spawned);
    assert.deepEqual(spawned, [["wt", "classify"]]);
    fs.tick(25 * 3_600_000);
    await fire(fs, "Stop", [], spawned);
    assert.equal(spawned.length, 2);
  });

  it("does not start without linked worktrees", async () => {
    const fs = memoryFs({
      [toAbsolutePath(join(PROJECT, ".git", "HEAD"))]: "ref: refs/heads/main\n",
      [toAbsolutePath(join(PROJECT, ".finitemonkey", "config.yml"))]: "lang: en\n",
    });
    const spawned: string[][] = [];
    await fire(fs, "Stop", [], spawned);
    assert.deepEqual(spawned, []);
  });

  it("wt classify writes the cache the session start reads", async () => {
    const repo = makeRepo({ "README.md": "# app\n", ".finitemonkey/config.yml": "lang: en\n" });
    repos.push(repo);
    const done = await cliJson(["wt", "classify"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(done.code, 0, done.stdout);
    assert.deepEqual(field(done.body, "data", "cleanable"), { count: 0, bytes: 0 });
    assert.match(repo.read(".finitemonkey/cache/wt-classes.json"), /"worktrees": \[\]/);
  });
});
